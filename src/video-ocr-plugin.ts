import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

const execFileAsync = promisify(execFile)

// PaddleOCR 边车服务的地址。先在本机启动 ocr-service/server.py，
// 再启动 dsh；也可以用 OCR_SERVICE_URL 环境变量改地址。
const OCR_SERVICE_URL = process.env.OCR_SERVICE_URL ?? 'http://127.0.0.1:8000'

export const name = 'video-ocr-plugin'
export const inject = ['tools']

interface OcrFrame {
  timestamp_seconds: number
  frame_file: string
  text: string
}

interface OcrResult {
  video_path: string
  duration_seconds: number
  interval_seconds: number
  frames: OcrFrame[]
  note: string
}

/**
 * 通过 PaddleOCR 边车服务识别一帧。
 * 边车服务（ocr-service/server.py）用 paddleocr==3.7.0（PP-OCRv6，中文）
 * 跑识别，本插件把抽出的帧以 multipart 表单发过去，拿回文字。
 * 边车没启动时直接报错，不返回假数据。
 */
async function ocrFrame(frameFile: string): Promise<string> {
  const form = new FormData()
  form.append('image', new Blob([readFileSync(frameFile)]), 'frame.jpg')

  let response: Response
  try {
    response = await fetch(`${OCR_SERVICE_URL}/ocr`, { method: 'POST', body: form })
  } catch {
    throw new Error(
      `连不上 PaddleOCR 边车服务（${OCR_SERVICE_URL}）。`
      + '请先在 ocr-service 目录里启动 python server.py，再重试。',
    )
  }
  if (!response.ok) {
    throw new Error(`PaddleOCR 边车服务返回 ${response.status}，帧 ${frameFile} 识别失败。`)
  }
  const result = await response.json() as { text?: string }
  return result.text ?? ''
}

async function probeDurationSeconds(videoPath: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    videoPath,
  ])
  const duration = Number.parseFloat(stdout.trim())
  return Number.isFinite(duration) ? duration : 0
}

async function extractFrames(videoPath: string, intervalSeconds: number, maxFrames: number): Promise<{ dir: string, files: string[] }> {
  const dir = mkdtempSync(join(tmpdir(), 'video-ocr-'))
  await execFileAsync('ffmpeg', [
    '-v', 'error',
    '-i', videoPath,
    '-vf', `fps=1/${intervalSeconds}`,
    '-frames:v', String(maxFrames),
    join(dir, 'frame-%04d.jpg'),
  ])
  const files = readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort()
  return { dir, files }
}

export function apply(ctx: Context) {
  console.log('[video-ocr-plugin] plugin loaded!')

  ctx.tools.register(defineTool({
    name: 'video_ocr',
    description:
      '对本地视频文件抽帧并做 OCR，按时间戳返回每帧识别出的文字。'
      + '适用于从视频里找字幕、招牌、车牌、车门文字等场景。',
    parameters: {
      video_path: {
        type: 'string',
        required: true,
        description: '本地视频文件的绝对路径，例如 /Users/you/videos/truck.mp4',
      },
      interval_seconds: {
        type: 'number',
        description: '抽帧间隔（秒），默认 5。间隔越小，帧越多、耗时越长。',
      },
      max_frames: {
        type: 'number',
        description: '最多抽取的帧数，默认 60。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          video_path: { type: 'string' },
          duration_seconds: { type: 'number' },
          interval_seconds: { type: 'number' },
          frames: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                timestamp_seconds: { type: 'number' },
                frame_file: { type: 'string' },
                text: { type: 'string' },
              },
            },
          },
          note: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const result = value as OcrResult
        const lines = result.frames.map(
          (f) => `[${f.timestamp_seconds.toFixed(1)}s] ${f.text}`,
        )
        return [{ type: 'text', text: lines.join('\n') || '没有抽到任何帧。' }]
      },
    },
    async execute(args) {
      const videoPath = args.video_path as string
      const intervalSeconds = (args.interval_seconds as number | undefined) ?? 5
      const maxFrames = (args.max_frames as number | undefined) ?? 60

      if (!existsSync(videoPath)) {
        throw new Error(`视频文件不存在：${videoPath}`)
      }
      if (intervalSeconds <= 0) {
        throw new Error('interval_seconds 必须大于 0')
      }

      const durationSeconds = await probeDurationSeconds(videoPath)
      const { dir, files } = await extractFrames(videoPath, intervalSeconds, maxFrames)

      const frames: OcrFrame[] = []
      for (let i = 0; i < files.length; i++) {
        const frameFile = join(dir, files[i])
        const timestampSeconds = i * intervalSeconds
        frames.push({
          timestamp_seconds: timestampSeconds,
          frame_file: frameFile,
          text: await ocrFrame(frameFile),
        })
      }

      return {
        video_path: videoPath,
        duration_seconds: durationSeconds,
        interval_seconds: intervalSeconds,
        frames,
        note: 'OCR 由 PaddleOCR 边车服务（paddleocr==3.7.0，PP-OCRv6，中文）提供。',
      } satisfies OcrResult
    },
  }))
}

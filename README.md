# dsh-plugin-video-ocr（v0.2：已接 PaddleOCR）

DeepSeek Harness（dsh）的通用视频 OCR 工具插件。

**当前状态：OCR 已接入 PaddleOCR 边车服务。** 插件抽帧后把每帧发给本地的 PaddleOCR 服务（paddleocr==3.7.0，PP-OCRv6，中文识别），按时间戳返回真实识别出的文字。不再返回桩数据；边车没启动时会直接报错，不返回假结果。

## 工具：video_ocr

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `video_path` | 是 | 本地视频文件的绝对路径 |
| `interval_seconds` | 否 | 抽帧间隔（秒），默认 5 |
| `max_frames` | 否 | 最多抽取帧数，默认 60 |

返回：视频路径、总时长、抽帧间隔，以及每帧的 `{timestamp_seconds, frame_file, text}` 列表。

## 前置条件

- Node.js（建议 22+）
- 已从源码检出 DeepSeek Harness 并能跑起来（`pnpm install` 后可启动）
- 本机装有 `ffmpeg` 和 `ffprobe`（抽帧和测时长用）

## 在 dsh 里跑起来

先启动 OCR 边车服务（新开一个终端）。边车服务用 conda 环境运行：

```sh
cd video-ocr-plugin/ocr-service
conda env create -f environment.yml   # 只需做一次；paddlepaddle 体积较大，首次安装需要几分钟
conda activate video-ocr
python server.py                      # 监听 http://127.0.0.1:8000
```

以后每次启动边车只需：

```sh
conda activate video-ocr
python server.py
```

确认边车在跑（打开 http://127.0.0.1:8000/health 应返回 `{"status":"ok"}`），再启动 dsh：

```sh
# 1. 先按官方文档把 dsh 从源码跑起来
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install

# 2. 把本插件目录放到 dsh 仓库旁（或任意位置），并改 cordis.yml 里的绝对路径
#    把 <ABSOLUTE_PATH_TO_THIS_DIR> 换成插件目录的绝对路径

# 3. 用覆盖层启动 Web UI
pnpm dsh web --patch /path/to/video-ocr-plugin/cordis.yml
```

启动期间终端应打印：

```
[video-ocr-plugin] plugin loaded!
```

然后打开 `http://127.0.0.1:3080`，对模型说：

> Use the video_ocr tool on /path/to/truck.mp4 with interval 5 seconds.

边车地址默认 `http://127.0.0.1:8000`，可用 `OCR_SERVICE_URL` 环境变量修改（启动 dsh 前设置）。

## 验证建议

先用之前那段 15 秒货车视频跑一遍，看返回的文字是不是帧里实际有的字；再换自己的近景货车录像验证车牌和车门文字。注意：远景航拍里车牌本来就看不清，认不出来是正常的，不是引擎问题。
## 类型检查

```sh
cd video-ocr-plugin
npm install
npm run typecheck
```

## 下一步

1. 在 dsh 里跑通：先确认插件加载成功，再用 15 秒货车视频调一次 `video_ocr`，看真实识别结果。
2. 帧去重：相邻帧文字相同时只保留一次，省 token。
3. 支持 RTSP 地址作为输入（复用货车项目的拉流经验）。
4. 走完上面几步后，再考虑打包成 npm 包发布。

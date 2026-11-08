"""PaddleOCR 边车服务：给 dsh video_ocr 插件提供 OCR 能力。

启动：
    pip install -r requirements.txt
    python server.py
默认监听 http://127.0.0.1:8000 ，插件通过 OCR_SERVICE_URL 环境变量找到它。

版本钉死（见 requirements.txt）：
- paddleocr==3.7.0：该版本默认使用 PP-OCRv6 模型，不指定模型就会用它，
  这里仍显式写出模型族，避免将来默认模型一换结果悄悄变了。
- 识别语言为中文（lang='ch'），覆盖车牌、车门上的中文字符。

接口：
- GET  /health  -> {"status": "ok"}
- POST /ocr     -> multipart 表单，字段 image=<图片文件>，
  返回 {"text": "整帧合并后的文字（按行用空格连接）", "lines": ["行1", "行2", ...]}
"""

import io

import uvicorn
from fastapi import FastAPI, File, UploadFile
from paddleocr import PaddleOCR

app = FastAPI(title="video-ocr sidecar")

# lang='ch'：中文识别；PaddleOCR 3.7.0 默认模型族为 PP-OCRv6。
ocr = PaddleOCR(lang="ch")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/ocr")
async def ocr_image(image: UploadFile = File(...)) -> dict:
    data = await image.read()
    # PaddleOCR 3.x: predict() 接受图片字节，返回每张图一个 dict，
    # 其中 rec_texts 是识别出的文字行列表。
    results = ocr.predict(io.BytesIO(data))
    lines: list[str] = []
    for result in results:
        lines.extend(result.get("rec_texts", []) or [])
    lines = [line.strip() for line in lines if line and line.strip()]
    return {"text": " ".join(lines), "lines": lines}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)

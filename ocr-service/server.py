"""PaddleOCR 边车服务：给 dsh video_ocr 插件提供 OCR 能力。

启动（conda 环境，见同目录 environment.yml）：
    conda env create -f environment.yml
    conda activate video-ocr
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

import numpy as np
import uvicorn
from fastapi import FastAPI, File, UploadFile
from paddleocr import PaddleOCR
from PIL import Image

app = FastAPI(title="video-ocr sidecar")

# lang='ch'：中文识别；PaddleOCR 3.7.0 默认模型族为 PP-OCRv6。
# enable_mkldnn=False：Paddle 3.3.x CPU 构建在 PIR + OneDNN 下跑 PP-OCRv6
# 检测器会崩溃（ConvertPirAttribute2RuntimeAttribute 不支持 Double 数组属性），
# 关掉 MKL-DNN 可绕过，正确性不受影响，只慢一点。
# 三个文档模块（方向分类/去扭曲/行方向）对视频帧无用，关掉省内存和时间。
ocr = PaddleOCR(
    lang="ch",
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=False,
    enable_mkldnn=False,
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/ocr")
async def ocr_image(image: UploadFile = File(...)) -> dict:
    data = await image.read()
    # PaddleOCR 3.x predict() 只接受文件路径或 numpy 数组；
    # 直接传 BytesIO 会被静默忽略（日志：Not supported input data type），
    # 返回空结果，所以先解码成 RGB numpy 数组。
    img = Image.open(io.BytesIO(data)).convert("RGB")
    results = ocr.predict(np.array(img))
    lines: list[str] = []
    for result in results:
        lines.extend(result.get("rec_texts", []) or [])
    lines = [line.strip() for line in lines if line and line.strip()]
    return {"text": " ".join(lines), "lines": lines}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)

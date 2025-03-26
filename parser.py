from typing import Tuple
from pdfminer.high_level import extract_text as extract_pdf_text
from docx import Document
import os
import tempfile

def extract_text_from_pdf(file_path: str) -> str:
    try:
        return extract_pdf_text(file_path)
    except Exception as e:
        return f"[ERROR: Could not extract PDF text] {str(e)}"

def extract_text_from_docx(file_path: str) -> str:
    try:
        doc = Document(file_path)
        full_text = "\n".join([para.text for para in doc.paragraphs])
        return full_text
    except Exception as e:
        return f"[ERROR: Could not extract DOCX text] {str(e)}"

def extract_text_from_file(uploaded_file) -> Tuple[str, str]:
    """
    Accepts an uploaded file and returns a tuple of (text, detected_type).
    """
    suffix = os.path.splitext(uploaded_file.filename)[-1].lower()

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(uploaded_file.file.read())
        tmp_path = tmp.name

    text, file_type = "", ""

    if suffix == ".pdf":
        text = extract_text_from_pdf(tmp_path)
        file_type = "pdf"
    elif suffix == ".docx":
        text = extract_text_from_docx(tmp_path)
        file_type = "docx"
    elif suffix == ".txt":
        with open(tmp_path, "r", encoding="utf-8") as f:
            text = f.read()
            file_type = "txt"
    else:
        text = "[ERROR: Unsupported file format]"
    print(text)
    os.unlink(tmp_path)
    return text, file_type
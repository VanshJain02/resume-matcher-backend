
from fastapi import FastAPI, UploadFile, File
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from matcher import analyze_resume_vs_job
from sentence_transformers import SentenceTransformer
from parser import extract_text_from_file

# Load model
model = SentenceTransformer("sentence-transformers/all-mpnet-base-v2")

app = FastAPI(title="AI Resume Matcher")

# CORS setup for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request and response schemas
class MatchRequest(BaseModel):
    resume_text: str
    job_description: str

class MatchResult(BaseModel):
    skills: float
    experience: float
    education: float
    projects: float
    summary: float
    overall_score: float

from fastapi import Form

@app.get("/")
async def root():
    return {"message": "Resume Matcher API is live!"}


@app.post("/upload-and-analyze", response_model=MatchResult)
async def upload_and_analyze(
    file: UploadFile = File(...),
    job_description: str = Form(...)
):
    text, file_type = extract_text_from_file(file)
    
    if text.startswith("[ERROR"):
        return {
            "skills": 0,
            "experience": 0,
            "education": 0,
            "projects": 0,
            "summary": 0,
            "overall_score": 0,
        }

    result = analyze_resume_vs_job(text, job_description)
    return result


@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/analyze", response_model=MatchResult)
def analyze(req: MatchRequest):
    result = analyze_resume_vs_job(text, job_description)
    return result

@app.post("/upload")
def upload_resume(file: UploadFile = File(...)):
    text, file_type = extract_text_from_file(file)
    return {"file_type": file_type, "extracted_text": text[:3000]}  # Optional: limit for preview

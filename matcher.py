# resume_job_matcher.py (Updated with Sentence Transformers)

from sentence_transformers import SentenceTransformer, util
import re

# Load lightweight model
MODEL_NAME = "sentence-transformers/all-mpnet-base-v2"
model = SentenceTransformer(MODEL_NAME)

def compare_texts(text1, text2):
    """
    Compare two texts using cosine similarity of sentence embeddings.
    """
    emb1 = model.encode(text1, convert_to_tensor=True)
    emb2 = model.encode(text2, convert_to_tensor=True)
    score = util.pytorch_cos_sim(emb1, emb2).item() * 100
    return round(score, 2)

def extract_sections(resume_text):
    """
    Extract basic resume sections using regex. Improve for production use.
    """
    sections = {
        "skills": "",
        "experience": "",
        "education": "",
        "projects": "",
        "summary": ""
    }
    text_lower = resume_text.lower()
    for key in sections:
        match = re.search(key, text_lower)
        if match:
            index = match.start()
            sections[key] = resume_text[index:index+1000]  # basic slicing
    return sections

def analyze_resume_vs_job(resume_text, job_desc):
    """
    Compare each resume section with the job description.
    """
    sections = extract_sections(resume_text)
    result = {}
    total_score = 0
    weights = {
        "skills": 0.3,
        "experience": 0.4,
        "education": 0.1,
        "projects": 0.15,
        "summary": 0.05
    }

    for section, text in sections.items():
        if text.strip():
            score = compare_texts(text, job_desc)
            result[section] = score
            total_score += score * weights[section]
        else:
            result[section] = 0.0

    result['overall_score'] = round(total_score, 2)
    return result

# Sample usage for testing
if __name__ == "__main__":
    resume_text = """
    Summary: Boring and lazy software developer with experience in Python, JavaScript, and React.
    Skills: Python, JavaScript, Java, Kotlin, React, PostgreSQL
    Experience: Developed a full-stack web app at XYZ Corp, improving performance by 30%.
    Projects: Built a resume parser using NLP and spaCy.
    Education: B.S. in Computer Science from ABC University.
    """

    job_description = """
    We are looking for a full-stack developer with experience in Python, Flask, and front-end frameworks like React or Java. 
    Familiarity with database systems such as PostgreSQL is a plus. The ideal candidate has built full-stack applications 
    and worked in agile environments.
    """

    results = analyze_resume_vs_job(resume_text, job_description)
    print("\nMatch Report:")
    for section, score in results.items():
        print(f"{section.capitalize()}: {score}%")
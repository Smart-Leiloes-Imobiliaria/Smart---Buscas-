from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from database import get_property_search
from worker import process_property_search


app = FastAPI(title="Property Collector Service")


class CollectorJob(BaseModel):
    searchId: str


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/jobs")
def process_job(job: CollectorJob):
    try:
        result = process_property_search(job.searchId)
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error

    if result is None:
        search = get_property_search(job.searchId)
        if search and search["status"] in ("PENDING", "RUNNING"):
            raise HTTPException(
                status_code=503,
                detail="Pesquisa aguardando a próxima tentativa.",
                headers={"Retry-After": "5"},
            )
        return {"ok": True, "status": "ALREADY_PROCESSED"}

    if result["status"] == "RETRYING":
        raise HTTPException(
            status_code=503,
            detail=result["error"],
            headers={
                "Retry-After": str(max(1, int(result["retry_after_seconds"])))
            },
        )

    return {"ok": result["status"] == "COMPLETED", **result}

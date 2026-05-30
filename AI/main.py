"""
Orchestration API: upload video → mapillary (Tools) → segmentation (HTTP) → triangulation.

Env:
  SEGMENTATION_API_URL  default http://127.0.0.1:8001
  SEGMENT_HTTP_TIMEOUT  seconds, default 7200
"""

from __future__ import annotations

import argparse
import asyncio
import functools
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, List, Tuple

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "Tools"))
sys.path.insert(0, str(ROOT / "Triangulation"))

load_dotenv(dotenv_path=ROOT / "API" / ".env")
load_dotenv(dotenv_path=ROOT / "Tools" / ".env")

from func.video_proocess_output import VideoProcessError, VideoProcessOutput  # noqa: E402
import triangulate_v6 as tri_v6  # noqa: E402

app = FastAPI(title="PBL7 Pipeline API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".JPG", ".JPEG", ".PNG"}


def _resolve_file(path_str: str, *, allowed_suffixes: set[str] | None = None) -> Path:
    p = Path(path_str).expanduser().resolve()
    if not p.is_file():
        raise HTTPException(status_code=404, detail=f"Không tìm thấy file: {p}")
    if allowed_suffixes is not None and p.suffix not in allowed_suffixes:
        raise HTTPException(status_code=400, detail=f"Đuôi file không hợp lệ: {p.suffix}")
    try:
        p.relative_to(ROOT.resolve())
    except ValueError:
        raise HTTPException(status_code=403, detail="Path phải nằm trong thư mục dự án PBL7")
    return p


def win_path_to_mnt(path: str) -> str:
    p = Path(path).resolve()
    s = os.fspath(p)
    if len(s) >= 2 and s[1] == ":":
        drive = s[0].lower()
        rest = s[2:].replace("\\", "/").lstrip("/")
        return f"/mnt/{drive}/{rest}" if rest else f"/mnt/{drive}"
    return s.replace("\\", "/")


def mnt_path_to_win(path: str) -> str:
    s = path.replace("/", "\\").strip()
    parts = [x for x in s.split("\\") if x]
    if len(parts) >= 3 and parts[0].lower() == "mnt" and len(parts[1]) == 1:
        drive_letter = parts[1].upper()
        tail = "\\".join(parts[2:])
        return f"{drive_letter}:\\{tail}"
    return os.path.normpath(path.replace("/", os.sep))


def _post_segment_json(base_url: str, payload: dict, timeout: float) -> dict:
    url = base_url.rstrip("/") + "/api/segment"
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise HTTPException(status_code=e.code, detail=f"Segmentation API: {detail}") from e
    except urllib.error.URLError as e:
        raise HTTPException(status_code=503, detail=f"Không gọi được segmentation: {e}") from e


def _classes_csv_path() -> str:
    p = ROOT / "Triangulation" / "input" / "classes_filtered.csv"
    if not p.is_file():
        raise HTTPException(status_code=500, detail=f"Thiếu file classes: {p}")
    return str(p.resolve())


def _run_seg_and_tri(*, uuid: str, img_dir_win: str, meta_json_win: str) -> dict[str, str]:
    seg_base = os.getenv("SEGMENTATION_API_URL", "http://127.0.0.1:8001").rstrip("/")
    seg_timeout = float(os.getenv("SEGMENT_HTTP_TIMEOUT", "7200"))

    seg = _post_segment_json(
        seg_base,
        {"uuid": uuid, "img_dir": win_path_to_mnt(img_dir_win)},
        timeout=seg_timeout,
    )
    json_dir_win = mnt_path_to_win(seg["json_dir"])
    out_json = str((ROOT / "Triangulation" / "output" / uuid / "obj_gps.json").resolve())
    vis_dir = str((ROOT / "Triangulation" / "output" / uuid / "vis").resolve())
    Path(out_json).parent.mkdir(parents=True, exist_ok=True)

    tri_args = argparse.Namespace(
        img_dir=img_dir_win,
        json_dir=json_dir_win,
        meta_json=meta_json_win,
        classes_csv=_classes_csv_path(),
        out_json=out_json,
        vis_dir=vis_dir,
        min_obs=3,
        min_kps=1,
    )
    tri_v6.MIN_KPS_IN_DET = tri_args.min_kps
    try:
        tri_v6.run_triangulation_pipeline(tri_args)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Triangulation failed: {e}") from e

    return {
        "json_dir_win": json_dir_win,
        "out_json": out_json,
        "vis_dir": vis_dir,
        "seg_count": str(seg.get("count", "")),
    }


def _build_images(*, uuid: str, img_dir_win: str, meta_json_win: str) -> dict[str, Any]:
    with open(meta_json_win, encoding="utf-8") as f:
        mapillary_data = json.load(f)
    if not isinstance(mapillary_data, list):
        raise HTTPException(status_code=500, detail="mapillary_image_description.json không phải list")

    return {
        "filename": Path(img_dir_win).name,
        "seq_uuid": uuid,
        "count": len(mapillary_data),
        "data": mapillary_data,
    }


def _build_segmentation_fe(json_dir_win: str) -> List[dict[str, Any]]:
    out: List[dict[str, Any]] = []
    json_dir = Path(json_dir_win)
    if not json_dir.is_dir():
        raise HTTPException(status_code=500, detail=f"json_dir không tồn tại: {json_dir}")

    for jp in sorted(json_dir.glob("*.json")):
        with open(jp, encoding="utf-8") as f:
            payload = json.load(f)
        if not isinstance(payload, dict):
            continue
        payload = dict(payload)
        seg_path = str(jp.resolve())
        payload.pop("instance_matrix", None)
        payload["segmentation_path"] = seg_path
        out.append(payload)
    return out


def _build_triangulation_fe(out_json: str) -> Any:
    with open(out_json, encoding="utf-8") as f:
        tracks = json.load(f)
    if not isinstance(tracks, list):
        raise HTTPException(status_code=500, detail="obj_gps.json không phải list")

    for track in tracks:
        observations = track.get("observations") or []
        obs_by_stem = {o["img_stem"]: o for o in observations if o.get("img_stem")}
        seen_detail: List[dict[str, Any]] = []
        for stem in track.get("seen_in") or []:
            obs = obs_by_stem.get(stem)
            if obs is not None:
                seen_detail.append({"image": stem, "instance_id": obs["instance_id"]})
            else:
                seen_detail.append({"image": stem, "instance_id": None})
        track["seen_in"] = seen_detail
    return tracks


def _pipeline_after_video(video_out: dict[str, Any]) -> dict[str, Any]:
    combined: List[dict[str, Any]] = []
    for row in video_out["data"]:
        uuid = row["uuid"]
        img_dir_win = row["img_dir"]
        meta_json_win = row["meta_json"]
        paths = _run_seg_and_tri(uuid=uuid, img_dir_win=img_dir_win, meta_json_win=meta_json_win)
        combined.append(
            {
                "uuid": uuid,
                "video": row,
                "segmentation": {"json_dir": paths["json_dir_win"], "count": paths["seg_count"]},
                "triangulation": {
                    "out_json": paths["out_json"],
                    "vis_dir": paths["vis_dir"],
                    "json_dir_used": paths["json_dir_win"],
                },
            }
        )
    return {"data": combined}


def _pipeline_after_video_fe(video_out: dict[str, Any]) -> dict[str, Any]:
    items: List[dict[str, Any]] = []
    for row in video_out["data"]:
        uuid = row["uuid"]
        img_dir_win = row["img_dir"]
        meta_json_win = row["meta_json"]
        paths = _run_seg_and_tri(uuid=uuid, img_dir_win=img_dir_win, meta_json_win=meta_json_win)
        items.append(
            {
                "images": _build_images(
                    uuid=uuid, img_dir_win=img_dir_win, meta_json_win=meta_json_win
                ),
                "segmentation": _build_segmentation_fe(paths["json_dir_win"]),
                "triangulation": _build_triangulation_fe(paths["out_json"]),
            }
        )
    if len(items) == 1:
        return items[0]
    return {"data": items}


def run_pipeline_from_upload_items(items: List[Tuple[str, bytes]]) -> dict[str, Any]:
    try:
        video_out = VideoProcessOutput().process(items)
    except VideoProcessError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail) from e
    return _pipeline_after_video(video_out)


def run_pipeline_from_upload_items_fe(items: List[Tuple[str, bytes]]) -> dict[str, Any]:
    try:
        video_out = VideoProcessOutput().process(items)
    except VideoProcessError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail) from e
    return _pipeline_after_video_fe(video_out)


def run_pipeline_from_video_paths(paths: List[str]) -> dict[str, Any]:
    for x in paths:
        p = Path(x).expanduser().resolve()
        if not p.is_file():
            raise HTTPException(status_code=400, detail=f"Không phải file: {p}")
    try:
        video_out = VideoProcessOutput().process(paths)
    except VideoProcessError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail) from e
    return _pipeline_after_video(video_out)


async def _read_upload_items(videos: List[UploadFile]) -> List[Tuple[str, bytes]]:
    if not videos:
        raise HTTPException(status_code=400, detail="Cần ít nhất 1 file video")
    items: List[Tuple[str, bytes]] = []
    for f in videos:
        if not f.filename:
            raise HTTPException(status_code=400, detail="File thiếu tên")
        try:
            data = await f.read()
        finally:
            await f.close()
        if not data:
            raise HTTPException(status_code=400, detail=f"File rỗng: {f.filename}")
        items.append((f.filename, data))
    return items


@app.get("/health")
def health():
    return {
        "status": "ok",
        "segmentation_api": os.getenv("SEGMENTATION_API_URL", "http://127.0.0.1:8001"),
        "pbl7_root": str(ROOT),
    }


@app.post("/pipeline/upload")
async def pipeline_upload(videos: List[UploadFile] = File(...)):
    items = await _read_upload_items(videos)
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, functools.partial(run_pipeline_from_upload_items, items))


@app.post("/pipeline/upload-from-fe")
async def pipeline_upload_from_fe(videos: List[UploadFile] = File(...)):
    """Giống /pipeline/upload nhưng response cho frontend: images, segmentation, triangulation."""
    items = await _read_upload_items(videos)
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, functools.partial(run_pipeline_from_upload_items_fe, items))


@app.get("/fetch/image")
def fetch_image(
    path: str = Query(..., description="Đường dẫn tuyệt đối tới file ảnh trên server"),
):
    """Query `path` → trả file ảnh (.jpg, ...)."""
    p = _resolve_file(path, allowed_suffixes=_IMAGE_EXTS)
    media = "image/jpeg" if p.suffix.lower() in (".jpg", ".jpeg") else "image/png"
    return FileResponse(path=str(p), media_type=media, filename=p.name)


@app.get("/fetch/instance-matrix")
def fetch_instance_matrix(
    path: str = Query(..., description="Đường dẫn tuyệt đối tới file segmentation JSON"),
):
    """Query `path` → đọc JSON và trả instance_matrix."""
    p = _resolve_file(path, allowed_suffixes={".json"})
    with open(p, encoding="utf-8") as f:
        payload = json.load(f)
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="File JSON không đúng định dạng object")
    matrix = payload.get("instance_matrix")
    if matrix is None:
        raise HTTPException(status_code=404, detail="JSON không có instance_matrix")
    return {
        "segmentation_path": str(p),
        "instance_matrix": matrix,
        "image_size": payload.get("image_size"),
        "num_instances": payload.get("num_instances"),
    }


@app.post("/pipeline/paths")
async def pipeline_paths(body: dict):
    paths = body.get("paths") or body.get("videos")
    if not paths or not isinstance(paths, list):
        raise HTTPException(status_code=400, detail='Body cần {"paths": ["D:\\\\...\\\\a.mp4", ...]}')
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None, functools.partial(run_pipeline_from_video_paths, [str(x) for x in paths])
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host='0.0.0.0',
        port=8010,
        reload=False,
    )

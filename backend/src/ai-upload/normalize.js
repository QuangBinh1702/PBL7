const path = require('path');

function parseNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function slugFromPath(imagePath) {
  const filename = path.basename(String(imagePath).replace(/\\/g, '/')) || 'frame';
  return filename
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'frame';
}

function parseMapCaptureTime(value) {
  const match = String(value || '').match(/^(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{3})$/);
  if (!match) return value || null;
  const [, year, month, day, hour, minute, second, millisecond] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${millisecond}Z`;
}

function getSegmentationKey(value) {
  return path.basename(String(value || '').replace(/\\/g, '/'));
}

function getRealAiFrames(payload) {
  const frames = payload?.images?.data;
  if (!Array.isArray(frames)) return null;
  const sequenceKey = firstDefined(payload?.images?.seq_uuid, payload?.images?.filename);

  const segmentationByImage = new Map();
  for (const entry of Array.isArray(payload?.segmentation) ? payload.segmentation : []) {
    segmentationByImage.set(getSegmentationKey(entry.image_path), entry);
  }

  return frames.map((frame) => {
    const segmentation = segmentationByImage.get(getSegmentationKey(frame.MAPFilename || frame.filename));
    return {
      path: frame.filename,
      provider_image_id: `ai-${slugFromPath(frame.MAPFilename || frame.filename)}`,
      lat: frame.MAPLatitude,
      lon: frame.MAPLongitude,
      compass_angle: firstDefined(frame.MAPCompassHeading?.TrueHeading, frame.MAPCompassHeading?.MagneticHeading),
      captured_at: parseMapCaptureTime(frame.MAPCaptureTime),
      sequence_key: firstDefined(sequenceKey, frame.MAPSequenceUUID),
      segmentation_path: segmentation?.segmentation_path || null,
      width: Array.isArray(segmentation?.image_size) ? segmentation.image_size[0] : frame.width,
      height: Array.isArray(segmentation?.image_size) ? segmentation.image_size[1] : frame.height,
      segmentations: Array.isArray(segmentation?.instances) ? segmentation.instances : [],
    };
  });
}

function getRawFrames(payload) {
  const realAiFrames = getRealAiFrames(payload);
  if (realAiFrames) return realAiFrames;

  const candidates = [
    payload?.frames,
    payload?.images,
    payload?.data?.frames,
    payload?.data?.images,
    payload?.data?.results,
    payload?.results,
    payload?.data,
  ];
  const frames = candidates.find(Array.isArray);
  return frames || [];
}

function normalizeSegmentations(item) {
  const raw = firstDefined(item.segmentations, item.segmentation, item.segments, item.objects, item.detections) || [];
  if (!Array.isArray(raw)) return [];

  return raw
    .map((segment) => {
      if (typeof segment === 'string') {
        return { label: segment, confidence: null };
      }
      if (!segment || typeof segment !== 'object') return null;
      const label = firstDefined(segment.label, segment.class_name, segment.name, segment.class, segment.category);
      if (!label) return null;
      const normalized = {
        label: String(label),
        confidence: parseNumber(firstDefined(segment.confidence, segment.score, segment.conf)),
      };
      const area = parseNumber(segment.area);
      const instanceId = parseNumber(segment.instance_id);
      if (area !== null) normalized.area = area;
      if (instanceId !== null) normalized.instance_id = instanceId;
      if (Array.isArray(segment.rgb)) normalized.rgb = segment.rgb;
      return normalized;
    })
    .filter(Boolean);
}

function buildSegmentationSummary(segmentations) {
  if (!segmentations.length) return '';
  if (segmentations.some((segment) => segment.instance_id !== undefined || segment.area !== undefined)) {
    const counts = new Map();
    for (const segment of segmentations) {
      counts.set(segment.label, (counts.get(segment.label) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 6)
      .map(([label, count]) => `${label} ${count}`)
      .join(', ');
  }
  return segmentations
    .slice(0, 6)
    .map((segment) => {
      if (segment.confidence === null) return segment.label;
      return `${segment.label} ${Math.round(segment.confidence * 100)}%`;
    })
    .join(', ');
}

function normalizeAiUploadFrames(payload) {
  return getRawFrames(payload)
    .map((item) => {
      if (typeof item === 'string') {
        item = { path: item };
      }
      if (!item || typeof item !== 'object') return null;

      const imagePath = firstDefined(item.path, item.image_path, item.imagePath, item.file_path, item.filePath, item.url);
      const lat = parseNumber(firstDefined(item.lat, item.latitude));
      const lon = parseNumber(firstDefined(item.lon, item.lng, item.longitude));
      if (!imagePath || lat === null || lon === null) return null;

      const segmentations = normalizeSegmentations(item);
      const sequenceKey = firstDefined(item.sequence_key, item.sequence_id, item.sequence_uuid);
      const normalized = {
        provider_image_id: String(firstDefined(item.provider_image_id, item.image_id, item.id, `ai-${slugFromPath(imagePath)}`)),
        image_path: String(imagePath),
        lat,
        lon,
        compass_angle: parseNumber(firstDefined(item.compass_angle, item.heading, item.bearing, item.compass)),
        captured_at: firstDefined(item.captured_at, item.timestamp, item.time) || null,
        width: parseNumber(item.width),
        height: parseNumber(item.height),
        segmentations,
        segmentation_summary: buildSegmentationSummary(segmentations),
      };
      if (sequenceKey) normalized.sequence_key = String(sequenceKey);
      if (item.segmentation_path) normalized.segmentation_path = String(item.segmentation_path);
      return normalized;
    })
    .filter(Boolean);
}

function normalizeAiTriangulationPoints(payload) {
  const raw = Array.isArray(payload?.triangulation) ? payload.triangulation : [];
  return raw
    .map((item) => {
      const lat = parseNumber(firstDefined(item.latitude, item.lat));
      const lon = parseNumber(firstDefined(item.longitude, item.lon, item.lng));
      const trackId = firstDefined(item.track_id, item.id);
      const label = firstDefined(item.class_name, item.label, item.name);
      if (lat === null || lon === null || trackId === undefined || !label) return null;
      return {
        point_id: `ai-object-${trackId}`,
        track_id: trackId,
        class_id: parseNumber(item.class_id),
        label: String(label),
        lat,
        lon,
        confidence: parseNumber(firstDefined(item.avg_score, item.score, item.confidence)),
        residual_m: parseNumber(item.residual_m),
        num_obs: parseNumber(item.num_obs),
        seen_in: Array.isArray(item.seen_in) ? item.seen_in : [],
      };
    })
    .filter(Boolean);
}

module.exports = {
  normalizeAiUploadFrames,
  normalizeAiTriangulationPoints,
};

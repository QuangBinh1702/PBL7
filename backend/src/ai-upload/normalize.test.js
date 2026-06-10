const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeAiUploadFrames, normalizeAiTriangulationPoints } = require('./normalize');

test('normalizes AI upload response with Windows paths, coordinates, and segmentation labels', () => {
  const payload = {
    frames: [
      {
        path: 'D:\\PBL7\\Tools\\database\\run-1\\frames\\frame_000001.jpg',
        lat: 16.074492,
        lon: 108.149104,
        heading: 91.3,
        timestamp: '2026-05-21T10:15:00.000Z',
        segmentations: [
          { label: 'road', confidence: 0.94 },
          { class_name: 'traffic_sign', score: 0.876 },
        ],
      },
    ],
  };

  assert.deepEqual(normalizeAiUploadFrames(payload), [
    {
      provider_image_id: 'ai-frame-000001-jpg',
      image_path: 'D:\\PBL7\\Tools\\database\\run-1\\frames\\frame_000001.jpg',
      lat: 16.074492,
      lon: 108.149104,
      compass_angle: 91.3,
      captured_at: '2026-05-21T10:15:00.000Z',
      width: null,
      height: null,
      segmentations: [
        { label: 'road', class_name: 'road', confidence: 0.94 },
        { label: 'traffic_sign', class_name: 'traffic_sign', confidence: 0.876 },
      ],
      segmentation_summary: 'road 94%, traffic_sign 88%',
    },
  ]);
});

test('normalizes nested AI response shapes and skips frames without valid coordinates', () => {
  const payload = {
    data: {
      images: [
        {
          image_path: 'D:/PBL7/Tools/database/run 2/frame 2.png',
          latitude: '16.1',
          longitude: '108.2',
          compass_angle: '45',
          objects: [{ name: 'person', conf: '0.5' }],
          width: 1920,
          height: 1080,
        },
        {
          image_path: 'D:/PBL7/Tools/database/run 2/missing-location.png',
          objects: [{ name: 'car', conf: 0.8 }],
        },
      ],
    },
  };

  assert.deepEqual(normalizeAiUploadFrames(payload), [
    {
      provider_image_id: 'ai-frame-2-png',
      image_path: 'D:/PBL7/Tools/database/run 2/frame 2.png',
      lat: 16.1,
      lon: 108.2,
      compass_angle: 45,
      captured_at: null,
      width: 1920,
      height: 1080,
      segmentations: [{ label: 'person', class_name: 'person', confidence: 0.5 }],
      segmentation_summary: 'person 50%',
    },
  ]);
});

test('normalizes real AI payload shape by matching images.data frames to segmentation entries', () => {
  const payload = {
    images: {
      filename: 'GS010051_from45s_0pct_mly.mp4',
      seq_uuid: 'de309a3d-54ad-43d5-b9e6-4ae768a54b04',
      data: [
        {
          MAPCaptureTime: '2025_08_22_02_32_52_875',
          MAPCompassHeading: { MagneticHeading: 228.67, TrueHeading: 228.67 },
          MAPFilename: 'GS010051_from45s_0pct_mly_0_000001.jpg',
          MAPLatitude: 16.0765723,
          MAPLongitude: 108.2072761,
          filename: 'D:\\PBL7\\Tools\\database\\de309a3d-54ad-43d5-b9e6-4ae768a54b04\\frames\\GS010051_from45s_0pct_mly.mp4\\GS010051_from45s_0pct_mly_0_000001.jpg',
        },
      ],
    },
    segmentation: [
      {
        image_path: 'GS010051_from45s_0pct_mly_0_000001.jpg',
        segmentation_path: 'D:\\PBL7\\Segmentation\\api\\output\\de309a3d-54ad-43d5-b9e6-4ae768a54b04\\json_dir\\GS010051_from45s_0pct_mly_0_000001.json',
        image_size: [1344, 4096],
        instances: [
          { instance_id: 1, class_name: 'object--vehicle--car', score: 0.999, area: 134264, rgb: [0, 0, 142] },
          { instance_id: 2, class_name: 'object--vehicle--car', score: 0.998, area: 6325, rgb: [0, 0, 142] },
          { instance_id: 3, class_name: 'object--traffic-sign--front', score: 0.997, area: 713, rgb: [220, 220, 0] },
        ],
      },
    ],
  };

  assert.deepEqual(normalizeAiUploadFrames(payload), [
    {
      provider_image_id: 'ai-gs010051-from45s-0pct-mly-0-000001-jpg',
      image_path: 'D:\\PBL7\\Tools\\database\\de309a3d-54ad-43d5-b9e6-4ae768a54b04\\frames\\GS010051_from45s_0pct_mly.mp4\\GS010051_from45s_0pct_mly_0_000001.jpg',
      lat: 16.0765723,
      lon: 108.2072761,
      compass_angle: 228.67,
      captured_at: '2025-08-22T02:32:52.875Z',
      sequence_key: 'de309a3d-54ad-43d5-b9e6-4ae768a54b04',
      segmentation_path: 'D:\\PBL7\\Segmentation\\api\\output\\de309a3d-54ad-43d5-b9e6-4ae768a54b04\\json_dir\\GS010051_from45s_0pct_mly_0_000001.json',
      width: 4096,
      height: 1344,
      segmentations: [
        {
          label: 'object--vehicle--car',
          class_name: 'object--vehicle--car',
          confidence: 0.999,
          area: 134264,
          instance_id: 1,
          rgb: [0, 0, 142],
        },
        {
          label: 'object--vehicle--car',
          class_name: 'object--vehicle--car',
          confidence: 0.998,
          area: 6325,
          instance_id: 2,
          rgb: [0, 0, 142],
        },
        {
          label: 'object--traffic-sign--front',
          class_name: 'object--traffic-sign--front',
          confidence: 0.997,
          area: 713,
          instance_id: 3,
          rgb: [220, 220, 0],
        },
      ],
      segmentation_summary: 'object--vehicle--car 2, object--traffic-sign--front 1',
    },
  ]);
});

test('normalizes public URL AI payload fields', () => {
  const payload = {
    images: {
      filename: 'GS010051_from45s_0pct_mly.mp4',
      seq_uuid: '63285916-c935-4174-8e62-2941f46c8ff5',
      data: [
        {
          MAPCaptureTime: '2025_08_22_02_32_52_875',
          MAPCompassHeading: { MagneticHeading: 228.67, TrueHeading: 228.67 },
          MAPFilename: 'GS010051_from45s_0pct_mly_0_000001.jpg',
          MAPLatitude: 16.0765723,
          MAPLongitude: 108.2072761,
          filename: '/__modal/volumes/database/job/frames/GS010051_from45s_0pct_mly_0_000001.jpg',
          image_url: 'https://example.test/jobs/job/frames/GS010051_from45s_0pct_mly_0_000001.jpg',
        },
      ],
    },
    segmentation: [
      {
        image_path: 'GS010051_from45s_0pct_mly_0_000001.jpg',
        segmentation_url: 'https://example.test/jobs/job/seg/json_dir/GS010051_from45s_0pct_mly_0_000001.json',
        image_size: [1344, 4096],
        instances: [
          {
            instance_id: 3,
            class_id: 53,
            class_name: 'object--traffic-sign--front',
            score: 0.9986,
            area: 570,
            rgb: [220, 220, 0],
            sign_name: 'Right Turn Only',
          },
        ],
      },
    ],
  };

  assert.deepEqual(normalizeAiUploadFrames(payload), [
    {
      provider_image_id: 'ai-gs010051-from45s-0pct-mly-0-000001-jpg',
      image_path: 'https://example.test/jobs/job/frames/GS010051_from45s_0pct_mly_0_000001.jpg',
      lat: 16.0765723,
      lon: 108.2072761,
      compass_angle: 228.67,
      captured_at: '2025-08-22T02:32:52.875Z',
      sequence_key: '63285916-c935-4174-8e62-2941f46c8ff5',
      segmentation_path: 'https://example.test/jobs/job/seg/json_dir/GS010051_from45s_0pct_mly_0_000001.json',
      width: 4096,
      height: 1344,
      segmentations: [
        {
          label: 'object--traffic-sign--front',
          class_name: 'object--traffic-sign--front',
          class_id: 53,
          confidence: 0.9986,
          area: 570,
          instance_id: 3,
          rgb: [220, 220, 0],
          sign_name: 'Right Turn Only',
        },
      ],
      segmentation_summary: 'object--traffic-sign--front 1',
    },
  ]);
});

test('normalizes triangulation object points from real AI payload shape', () => {
  const payload = {
    triangulation: [
      {
        track_id: 9,
        class_id: 52,
        class_name: 'object--traffic-sign--back',
        latitude: 16.07643717,
        longitude: 108.20715043,
        residual_m: 0.424,
        num_obs: 4,
        avg_score: 0.994,
        seen_in: [{ image_path: 'GS010051_from45s_0pct_mly_0_000001.jpg' }],
      },
    ],
  };

  assert.deepEqual(normalizeAiTriangulationPoints(payload), [
    {
      point_id: 'ai-object-9',
      track_id: 9,
      class_id: 52,
      label: 'object--traffic-sign--back',
      sign_name: null,
      lat: 16.07643717,
      lon: 108.20715043,
      confidence: 0.994,
      residual_m: 0.424,
      num_obs: 4,
      seen_in: [{ image: 'GS010051_from45s_0pct_mly_0_000001', instance_id: null }],
    },
  ]);
});

test('normalizes string seen_in entries using observations', () => {
  const payload = {
    triangulation: [
      {
        track_id: 5,
        class_id: 53,
        class_name: 'object--traffic-sign--front',
        latitude: 16.07649767,
        longitude: 108.20712081,
        num_obs: 3,
        avg_score: 0.9986,
        seen_in: [
          'GS010051_from45s_0pct_mly_0_000002',
          'GS010051_from45s_0pct_mly_0_000003',
          'GS010051_from45s_0pct_mly_0_000004',
        ],
        observations: [
          { img_stem: 'GS010051_from45s_0pct_mly_0_000002', instance_id: 8 },
          { img_stem: 'GS010051_from45s_0pct_mly_0_000003', instance_id: 16 },
          { img_stem: 'GS010051_from45s_0pct_mly_0_000004', instance_id: 5 },
        ],
      },
    ],
  };

  assert.deepEqual(normalizeAiTriangulationPoints(payload), [
    {
      point_id: 'ai-object-5',
      track_id: 5,
      class_id: 53,
      label: 'object--traffic-sign--front',
      sign_name: null,
      lat: 16.07649767,
      lon: 108.20712081,
      confidence: 0.9986,
      residual_m: null,
      num_obs: 3,
      seen_in: [
        { image: 'GS010051_from45s_0pct_mly_0_000002', instance_id: 8 },
        { image: 'GS010051_from45s_0pct_mly_0_000003', instance_id: 16 },
        { image: 'GS010051_from45s_0pct_mly_0_000004', instance_id: 5 },
      ],
    },
  ]);
});

test('keeps traffic-sign class label and stores sign_name separately', () => {
  const payload = {
    segmentation: [
      {
        image_path: 'GS010051_from45s_0pct_mly_0_000001.jpg',
        instances: [
          {
            instance_id: 20,
            class_name: 'object--traffic-sign--front',
            sign_name: 'Right Turn Only',
          },
        ],
      },
    ],
    triangulation: [
      {
        track_id: 2,
        class_id: 53,
        class_name: 'object--traffic-sign--front',
        latitude: 16.07625676,
        longitude: 108.20682356,
        residual_m: 0.948,
        num_obs: 6,
        avg_score: 0.9115,
        seen_in: [
          {
            image: 'GS010051_from45s_0pct_mly_0_000001',
            instance_id: 20,
          },
        ],
      },
    ],
  };

  assert.deepEqual(normalizeAiTriangulationPoints(payload), [
    {
      point_id: 'ai-object-2',
      track_id: 2,
      class_id: 53,
      label: 'object--traffic-sign--front',
      sign_name: 'Right Turn Only',
      lat: 16.07625676,
      lon: 108.20682356,
      confidence: 0.9115,
      residual_m: 0.948,
      num_obs: 6,
      seen_in: [
        {
          image: 'GS010051_from45s_0pct_mly_0_000001',
          instance_id: 20,
        },
      ],
    },
  ]);
});

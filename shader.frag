precision mediump float;

uniform sampler2D u_video;
uniform sampler2D u_lut;
uniform bool u_enableLUT;
varying vec2 v_texCoord;

const float size = 64.0; // 64x64x64 LUT
const float tiles = 8.0; // 8x8 grid

vec3 applyLUT(vec3 color) {
  // Scale color to [0, size-1]
  float r = clamp(color.r, 0.0, 1.0) * (size - 1.0);
  float g = clamp(color.g, 0.0, 1.0) * (size - 1.0);
  float b = clamp(color.b, 0.0, 1.0) * (size - 1.0);

  // Get integer and fractional part of blue (z)
  float zSlice = floor(b);
  float zOffset = fract(b);

  // Compute tile position in 8x8 grid
  float tileX = mod(zSlice, tiles);
  float tileY = floor(zSlice / tiles);

  // Compute normalized coordinates within the tile
  vec2 uv1 = vec2(
    (r + 0.5) / size,
    (g + 0.5) / size
  );

  // Offset by tile position in the 512x512 texture
  uv1.x = (uv1.x + tileX) / tiles;
  uv1.y = (uv1.y + tileY) / tiles;

  // For trilinear interpolation, sample next slice
  float zSlice2 = min(zSlice + 1.0, size - 1.0);
  float tileX2 = mod(zSlice2, tiles);
  float tileY2 = floor(zSlice2 / tiles);

  vec2 uv2 = vec2(
    (r + 0.5) / size,
    (g + 0.5) / size
  );
  uv2.x = (uv2.x + tileX2) / tiles;
  uv2.y = (uv2.y + tileY2) / tiles;

  vec3 result1 = texture2D(u_lut, uv1).rgb;
  vec3 result2 = texture2D(u_lut, uv2).rgb;

  return mix(result1, result2, zOffset);
}

void main() {
  vec4 videoColor = texture2D(u_video, v_texCoord);
  if (u_enableLUT) {
    gl_FragColor = vec4(applyLUT(videoColor.rgb), 1.0);
  } else {
    gl_FragColor = videoColor;
  }
}

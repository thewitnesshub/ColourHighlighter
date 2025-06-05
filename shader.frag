precision mediump float;

uniform sampler2D u_video;
uniform sampler2D u_lut;
uniform bool u_enableLUT;
varying vec2 v_texCoord;

const float size = 8.0; // Assuming 512x512 LUT for 64^3

vec3 applyLUT(vec3 color) {
  float blueColor = color.b * (size - 1.0);
  float slice = floor(blueColor);
  float zOffset = fract(blueColor);

  float x = color.r * (size - 1.0);
  float y = color.g * (size - 1.0);

  float s1 = slice / size;
  float s2 = (slice + 1.0) / size;

  vec2 lutCoord1 = vec2(x / (size - 1.0), y / (size - 1.0)) / size + vec2(0.0, s1);
  vec2 lutCoord2 = vec2(x / (size - 1.0), y / (size - 1.0)) / size + vec2(0.0, s2);

  vec3 result1 = texture2D(u_lut, lutCoord1).rgb;
  vec3 result2 = texture2D(u_lut, lutCoord2).rgb;

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

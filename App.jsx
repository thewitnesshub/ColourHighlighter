import React, { useRef, useEffect, useState } from "react";
import { filterConfigs } from "./configs.js";
import "./main.css";

const SHADER_URL = process.env.PUBLIC_URL + "/shader.frag";

// Utility to fill arrays for chroma/color correction uniforms
const fillArray = (arr, def, len = 4) => {
  const out = [];
  for (let i = 0; i < len; ++i) out.push(arr[i] !== undefined ? arr[i] : def);
  return out;
};

function App() {
  // State & refs
  const [showPanel, setShowPanel] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const [currentFilter, setCurrentFilter] = useState(
    JSON.parse(JSON.stringify(filterConfigs.find((f) => f.id === "blue")))
  );
  const [activeIdx, setActiveIdx] = useState(1);
  const canvasRef = useRef();
  const videoRef = useRef();
  const glRef = useRef();
  const glVars = useRef({}); // Store all gl-related stuff here

  // --- INITIALIZATION ---
  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas.getContext("webgl");
    glRef.current = gl;
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
    // eslint-disable-next-line
  }, []);

  function resizeCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const gl = glRef.current;
    if (gl) gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  }

  // --- SCREEN CAPTURE START ---
  async function startCapture() {
    setShowWelcome(false);
    setShowPanel(true);

    // Start screen capture
    const video = videoRef.current;
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 60, max: 60 } },
    });
    video.srcObject = stream;
    video.onloadedmetadata = () => {
      video.play();
      setupWebGL().then(renderLoop);
      video.onloadedmetadata = null;
    };
    stream.getVideoTracks()[0].addEventListener("ended", () => {
      setShowWelcome(true);
      setShowPanel(false);
      // Optionally clear canvas here
    });
    if (video.readyState >= 1) {
      video.play();
      setupWebGL().then(renderLoop);
    }
  }

  // --- WEBGL SETUP ---
  async function setupWebGL() {
    const canvas = canvasRef.current;
    const gl = glRef.current;
    const video = videoRef.current;

    // Load shaders
    const vertexShaderSource = `
      attribute vec2 a_position;
      attribute vec2 a_texCoord;
      varying vec2 v_texCoord;
      uniform vec2 u_scale;
      void main() {
        v_texCoord = a_texCoord;
        gl_Position = vec4(a_position * u_scale, 0, 1);
      }
    `;
    const fragSrc = await fetch(SHADER_URL).then((r) => r.text());
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragSrc);
    const program = createProgram(gl, vertexShader, fragmentShader);
    gl.useProgram(program);

    // Buffers/attributes
    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    const positions = new Float32Array([
      -1, -1, 0, 1,
      1, -1, 1, 1,
      -1, 1, 0, 0,
      1, 1, 1, 0,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const a_position = gl.getAttribLocation(program, "a_position");
    const a_texCoord = gl.getAttribLocation(program, "a_texCoord");
    gl.enableVertexAttribArray(a_position);
    gl.enableVertexAttribArray(a_texCoord);
    gl.vertexAttribPointer(a_position, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(a_texCoord, 2, gl.FLOAT, false, 16, 8);

    // Uniforms
    glVars.current = {
      program,
      u_scale: gl.getUniformLocation(program, "u_scale"),
      lutLocation: gl.getUniformLocation(program, "u_lut"),
      u_enableLUT: gl.getUniformLocation(program, "u_enableLUT"),
      u_numChromaKeys: gl.getUniformLocation(program, "u_numChromaKeys"),
      u_ckey_color: gl.getUniformLocation(program, "u_ckey_color"),
      u_ckey_similarity: gl.getUniformLocation(program, "u_ckey_similarity"),
      u_ckey_smoothness: gl.getUniformLocation(program, "u_ckey_smoothness"),
      u_ckey_spill: gl.getUniformLocation(program, "u_ckey_spill"),
      u_numColorCorrections: gl.getUniformLocation(program, "u_numColorCorrections"),
      u_ccor_gamma: gl.getUniformLocation(program, "u_ccor_gamma"),
      u_ccor_contrast: gl.getUniformLocation(program, "u_ccor_contrast"),
      u_ccor_saturation: gl.getUniformLocation(program, "u_ccor_saturation"),
      videoTexture: null,
      lutTexture: null,
      lastVideoWidth: video.videoWidth,
      lastVideoHeight: video.videoHeight,
    };

    // Video texture
    glVars.current.videoTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, glVars.current.videoTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(program, "u_video"), 0);

    // LUT texture
    glVars.current.lutTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, glVars.current.lutTexture);
    gl.uniform1i(glVars.current.lutLocation, 1);

    await setGLFilter(currentFilter);

    // Aspect correction
    function updateScale() {
      const canvasAspect = canvas.width / canvas.height;
      const videoAspect = video.videoWidth / video.videoHeight || 1;
      let scaleX = 1,
        scaleY = 1;
      if (canvasAspect > videoAspect) scaleX = videoAspect / canvasAspect;
      else scaleY = canvasAspect / videoAspect;
      gl.useProgram(program);
      gl.uniform2f(glVars.current.u_scale, scaleX, scaleY);
    }
    window.addEventListener("resize", updateScale);
    video.addEventListener("loadedmetadata", updateScale);
    updateScale();
  }

  // --- WEBGL: SHADER HELPERS ---
  function createShader(gl, type, src) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader));
    }
    return shader;
  }
  function createProgram(gl, vs, fs) {
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program));
    }
    return program;
  }

  // --- WEBGL: SET FILTER UNIFORMS/LUT ---
  async function setGLFilter(config) {
    const gl = glRef.current;
    const { program, lutTexture, lutLocation, u_enableLUT, u_numChromaKeys, u_ckey_color, u_ckey_similarity, u_ckey_smoothness, u_ckey_spill, u_numColorCorrections, u_ccor_gamma, u_ccor_contrast, u_ccor_saturation } = glVars.current;

    gl.useProgram(program);

    // Chroma key uniforms
    const chromaKeys = config.chromaKeys || [];
    gl.uniform1i(u_numChromaKeys, chromaKeys.length);
    const ckey_color = fillArray(chromaKeys.map((k) => k.ckey_color), [0, 0, 0]);
    const ckey_similarity = fillArray(chromaKeys.map((k) => k.ckey_similarity), 0.0);
    const ckey_smoothness = fillArray(chromaKeys.map((k) => k.ckey_smoothness), 0.0);
    const ckey_spill = fillArray(chromaKeys.map((k) => k.ckey_spill), 0.0);
    gl.uniform3fv(u_ckey_color, ckey_color.flat());
    gl.uniform1fv(u_ckey_similarity, ckey_similarity);
    gl.uniform1fv(u_ckey_smoothness, ckey_smoothness);
    gl.uniform1fv(u_ckey_spill, ckey_spill);

    // Color correction uniforms
    const colorCorrections = config.colorCorrections || [];
    gl.uniform1i(u_numColorCorrections, colorCorrections.length);
    const ccor_gamma = fillArray(colorCorrections.map((c) => c.gamma), 0.0);
    const ccor_contrast = fillArray(colorCorrections.map((c) => c.contrast), 0.0);
    const ccor_saturation = fillArray(colorCorrections.map((c) => c.saturation), 1.0);
    gl.uniform1fv(u_ccor_gamma, ccor_gamma);
    gl.uniform1fv(u_ccor_contrast, ccor_contrast);
    gl.uniform1fv(u_ccor_saturation, ccor_saturation);

    // LUT
    if (!config.enableLUT) {
      gl.uniform1i(u_enableLUT, 0);
    } else {
      gl.uniform1i(u_enableLUT, 1);
      await loadLUTTexture(config.lut, lutTexture);
    }
  }
  async function loadLUTTexture(lutFile, texture) {
    if (!lutFile) return;
    return new Promise((resolve) => {
      const img = new window.Image();
      img.onload = () => {
        const gl = glRef.current;
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        resolve();
      };
      img.src = lutFile.startsWith("LUTs/") ? process.env.PUBLIC_URL + "/" + lutFile : lutFile;
    });
  }

  // --- WEBGL: RENDER LOOP ---
  function renderLoop() {
    const gl = glRef.current;
    const { videoTexture } = glVars.current;
    const video = videoRef.current;

    function draw() {
      // Update video frame as texture
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, videoTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      requestAnimationFrame(draw);
    }
    draw();
  }

  // --- PANEL BUTTON HANDLERS ---
  function onMinimizePanel() {
    setShowPanel(false);
    // FAB will appear (see below)
  }
  function onRestorePanel() {
    setShowPanel(true);
  }
  async function onSelectFilter(filter, idx) {
    setCurrentFilter(JSON.parse(JSON.stringify(filter)));
    setActiveIdx(idx);
    await setGLFilter(filter);
  }

  // --- SLIDERS: UI + LOGIC ---
  function renderSliders() {
    // chromaKey and colorCorrection sliders
    const update = async (kind, idx, prop, val) => {
      const newFilter = JSON.parse(JSON.stringify(currentFilter));
      newFilter[kind][idx][prop] = parseFloat(val);
      setCurrentFilter(newFilter);
      await setGLFilter(newFilter);
    };

    return (
      <div id="slidersBox" style={{ margin: "16px 0" }}>
        {(currentFilter.chromaKeys || []).map((ck, i) => (
          <React.Fragment key={i}>
            {["ckey_similarity", "ckey_smoothness", "ckey_spill"].map((prop, j) => (
              <div key={prop} style={{ marginBottom: 10 }}>
                <label style={{ fontSize: "0.96em" }}>
                  {`${prop.replace("ckey_", "Chroma ").replace(/_/g, " ")} #${i + 1}: `}
                  <span>{ck[prop]}</span>
                </label>
                <input
                  type="range"
                  min={prop === "ckey_similarity" ? 0.0 : prop === "ckey_smoothness" ? 0.0 : 0.0}
                  max={prop === "ckey_similarity" ? 0.2 : prop === "ckey_smoothness" ? 100.0 : 400.0}
                  step={prop === "ckey_similarity" ? 0.001 : prop === "ckey_smoothness" ? 0.1 : 1.0}
                  value={ck[prop]}
                  onChange={(e) => update("chromaKeys", i, prop, e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>
            ))}
          </React.Fragment>
        ))}
        {(currentFilter.colorCorrections || []).map((cc, i) => (
          <React.Fragment key={i}>
            {["gamma", "contrast", "saturation"].map((prop) => (
              <div key={prop} style={{ marginBottom: 10 }}>
                <label style={{ fontSize: "0.96em" }}>
                  {`${prop.charAt(0).toUpperCase() + prop.slice(1)} #${i + 1}: `}
                  <span>{cc[prop]}</span>
                </label>
                <input
                  type="range"
                  min={prop === "gamma" ? -2.0 : -2.0}
                  max={prop === "gamma" ? 2.0 : 4.0}
                  step={prop === "saturation" ? 0.01 : 0.01}
                  value={cc[prop]}
                  onChange={(e) => update("colorCorrections", i, prop, e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
    );
  }

  // --- RENDER ---
  return (
    <div id="container" style={{ height: "100vh", width: "100vw", position: "relative" }}>
      {showPanel && (
        <div id="control-pane">
          <button id="minimizePanelBtn" title="Minimize panel" aria-label="Minimize panel" onClick={onMinimizePanel}>
            ☰
          </button>
          <div style={{ textAlign: "center" }}>
            <img src={process.env.PUBLIC_URL + "/assets/logo.svg"} alt="Logo" style={{ width: "100%", maxWidth: 160, marginBottom: 18, display: "block", marginLeft: "auto", marginRight: "auto" }} />
            <h3>Colour Highlighter</h3>
          </div>
          <div>
            <div id="filterButtons" style={{ marginBottom: 6 }}>Select Highlighter:</div>
            <div>
              {filterConfigs.map((f, idx) => (
                <button
                  className={`lut-btn${activeIdx === idx ? " active" : ""}`}
                  key={f.id}
                  onClick={() => onSelectFilter(f, idx)}
                  style={{ margin: 2, padding: "8px 12px", fontSize: "1rem" }}
                >
                  {f.name || f.id}
                </button>
              ))}
            </div>
          </div>
          {renderSliders()}
        </div>
      )}
      {showWelcome && (
        <div id="welcomeWin">
          <div className="welcome-text">
            Welcome!<br />
            Please click below to get started.
          </div>
          <button id="startBtn" onClick={startCapture}>
            Start Capture
          </button>
        </div>
      )}
      <canvas id="glcanvas" ref={canvasRef} style={{ flex: 1, display: "block", width: "100%", height: "100%", zIndex: 10 }} />
      <video id="video" ref={videoRef} autoPlay muted playsInline style={{ display: "none" }} />
      {!showPanel && !showWelcome && (
        <button id="fab" title="Show panel" aria-label="Show panel" onClick={onRestorePanel} style={{
          position: "fixed", top: 36, right: 36, width: 48, height: 48, background: "rgb(251,180,0)", color: "#111", border: "none", borderRadius: "50%", fontSize: "1.2rem", fontWeight: 700, zIndex: 30
        }}>
          ☰
        </button>
      )}
    </div>
  );
}

export default App;

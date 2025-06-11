import { filterConfigs } from "./configs.js";

const canvas = document.getElementById("glcanvas");
const gl = canvas.getContext("webgl");
const video = document.getElementById("video");
const welcomeWin = document.getElementById("welcomeWin");
const controlPane = document.getElementById("control-pane");
const fab = document.getElementById("fab");
const minimizePanelBtn = document.getElementById("minimizePanelBtn");

// --- Picture-in-Picture Button ---
let pipBtn = document.createElement("button");
pipBtn.textContent = "Pop Out";
pipBtn.style.margin = "10px 0";
pipBtn.style.background = "#fba400";
pipBtn.style.color = "#111";
pipBtn.style.fontWeight = "bold";
pipBtn.style.border = "none";
pipBtn.style.borderRadius = "8px";
pipBtn.style.padding = "8px 20px";
pipBtn.style.cursor = "pointer";
pipBtn.style.fontSize = "1rem";
pipBtn.style.transition = "background 0.2s";
pipBtn.addEventListener("mouseover", () => pipBtn.style.background = "#fff5e1");
pipBtn.addEventListener("mouseout", () => pipBtn.style.background = "#fba400");
pipBtn.addEventListener("click", async () => {
    if (video.readyState === 0) return; // not loaded yet
    if (document.pictureInPictureElement) {
        document.exitPictureInPicture();
    } else {
        try {
            await video.requestPictureInPicture();
        } catch (e) {
            alert("Picture-in-Picture is not supported or video not available yet.");
        }
    }
});
// Insert after filter buttons
setTimeout(() => {
    let filterBar = document.getElementById("filterButtons");
    if (filterBar && !document.getElementById("pipBtn")) {
        pipBtn.id = "pipBtn";
        filterBar.appendChild(pipBtn);
    }
}, 200);

// On load: Hide control pane and FAB
if (controlPane) controlPane.style.display = "none";
if (fab) {
    fab.classList.remove("show");
    fab.style.display = "none";
}

// Resize canvas to fill screen
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// Utility: load shader
async function loadShaderFromFile(file, type) {
    const res = await fetch(file);
    const src = await res.text();
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader));
    }
    return shader;
}

let currentFilter = null;
let currentLUT = null;
let lutTexture = null;
let lutImage = null;
let lutLocation = null;
let glProgram = null;
let u_enableLUT = null;
let u_enableChromaKey = null;
let u_enableColorCorrection = null;
let u_numChromaKeys = null;
let u_numColorCorrections = null;
let u_ckey_color = null, u_ckey_similarity = null, u_ckey_smoothness = null, u_ckey_spill = null;
let u_ccor_gamma = null, u_ccor_contrast = null, u_ccor_saturation = null;
let lutEnabled = true;

async function loadLUTTexture(lutFile) {
    if (!lutTexture) {
        lutTexture = gl.createTexture();
    }
    lutImage = new Image();
    lutImage.src = lutFile && !lutFile.startsWith("LUTs/") && lutFile !== "none" ? "LUTs/" + lutFile : lutFile;
    await lutImage.decode();

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, lutTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, lutImage);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
}

async function initGL() {
    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader, `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;
    uniform vec2 u_scale;
    void main() {
      v_texCoord = a_texCoord;
      gl_Position = vec4(a_position * u_scale, 0, 1);
    }
  `);
    gl.compileShader(vertexShader);

    const fragmentShader = await loadShaderFromFile('shader.frag', gl.FRAGMENT_SHADER);

    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.useProgram(program);

    glProgram = program;

    const u_scale = gl.getUniformLocation(program, "u_scale");

    function updateScale() {
        const canvasAspect = canvas.width / canvas.height;
        const videoAspect = video.videoWidth / video.videoHeight || 1;
        let scaleX = 1, scaleY = 1;
        if (canvasAspect > videoAspect) {
            scaleX = videoAspect / canvasAspect;
        } else {
            scaleY = canvasAspect / videoAspect;
        }
        gl.useProgram(program);
        gl.uniform2f(u_scale, scaleX, scaleY);
    }
    window.addEventListener("resize", updateScale);
    video.addEventListener("loadedmetadata", updateScale);
    updateScale();

    // --- Aspect ratio correction: Track video dimensions ---
    let lastVideoWidth = video.videoWidth;
    let lastVideoHeight = video.videoHeight;

    // Quad
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    const positions = new Float32Array([
        -1, -1, 0, 1,
        1, -1, 1, 1,
        -1, 1, 0, 0,
        1, 1, 1, 0
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const a_position = gl.getAttribLocation(program, "a_position");
    const a_texCoord = gl.getAttribLocation(program, "a_texCoord");
    gl.enableVertexAttribArray(a_position);
    gl.enableVertexAttribArray(a_texCoord);
    gl.vertexAttribPointer(a_position, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(a_texCoord, 2, gl.FLOAT, false, 16, 8);

    // LUT Texture
    lutLocation = gl.getUniformLocation(program, "u_lut");
    u_enableLUT = gl.getUniformLocation(program, "u_enableLUT");
    u_enableChromaKey = gl.getUniformLocation(program, "u_enableChromaKey");
    u_enableColorCorrection = gl.getUniformLocation(program, "u_enableColorCorrection");
    u_numChromaKeys = gl.getUniformLocation(program, "u_numChromaKeys");
    u_numColorCorrections = gl.getUniformLocation(program, "u_numColorCorrections");
    u_ckey_color = gl.getUniformLocation(program, "u_ckey_color");
    u_ckey_similarity = gl.getUniformLocation(program, "u_ckey_similarity");
    u_ckey_smoothness = gl.getUniformLocation(program, "u_ckey_smoothness");
    u_ckey_spill = gl.getUniformLocation(program, "u_ckey_spill");
    u_ccor_gamma = gl.getUniformLocation(program, "u_ccor_gamma");
    u_ccor_contrast = gl.getUniformLocation(program, "u_ccor_contrast");
    u_ccor_saturation = gl.getUniformLocation(program, "u_ccor_saturation");
    await loadLUTTexture(currentLUT);
    gl.uniform1i(lutLocation, 1); // texture unit 1
    gl.uniform1i(u_enableLUT, 1);

    // Video Texture
    const videoTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, videoTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const videoLocation = gl.getUniformLocation(program, "u_video");
    gl.uniform1i(videoLocation, 0); // texture unit 0

    // Aspect correction callback for render loop
    function checkVideoAspect() {
        if (video.videoWidth !== lastVideoWidth || video.videoHeight !== lastVideoHeight) {
            lastVideoWidth = video.videoWidth;
            lastVideoHeight = video.videoHeight;
            updateScale();
        }
    }

    return { videoTexture, checkVideoAspect };
}

// Helper to fill arrays to length 4 with defaults
function fillArray(arr, def, len = 4) {
    const out = [];
    for (let i = 0; i < len; ++i) {
        out.push(arr[i] !== undefined ? arr[i] : def);
    }
    return out;
}

async function setFilter(config) {
    gl.useProgram(glProgram);

    // Chroma Key
    const chromaKeys = config.chromaKeys || [];
    gl.uniform1i(u_numChromaKeys, chromaKeys.length);
    const ckey_color = fillArray(chromaKeys.map(k => k.ckey_color), [0, 0, 0]);
    const ckey_similarity = fillArray(chromaKeys.map(k => k.ckey_similarity), 0.0);
    const ckey_smoothness = fillArray(chromaKeys.map(k => k.ckey_smoothness), 0.0);
    const ckey_spill = fillArray(chromaKeys.map(k => k.ckey_spill), 0.0);
    gl.uniform3fv(u_ckey_color, ckey_color.flat());
    gl.uniform1fv(u_ckey_similarity, ckey_similarity);
    gl.uniform1fv(u_ckey_smoothness, ckey_smoothness);
    gl.uniform1fv(u_ckey_spill, ckey_spill);

    // Color Correction
    const colorCorrections = config.colorCorrections || [];
    gl.uniform1i(u_numColorCorrections, colorCorrections.length);
    const ccor_gamma = fillArray(colorCorrections.map(c => c.gamma), 0.0);
    const ccor_contrast = fillArray(colorCorrections.map(c => c.contrast), 0.0);
    const ccor_saturation = fillArray(colorCorrections.map(c => c.saturation), 1.0);
    gl.uniform1fv(u_ccor_gamma, ccor_gamma);
    gl.uniform1fv(u_ccor_contrast, ccor_contrast);
    gl.uniform1fv(u_ccor_saturation, ccor_saturation);

    // LUT
    if (!config.enableLUT) {
        lutEnabled = false;
        gl.uniform1i(u_enableLUT, 0);
    } else {
        lutEnabled = true;
        await loadLUTTexture(config.lut);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, lutTexture);
        gl.uniform1i(lutLocation, 1);
        gl.uniform1i(u_enableLUT, 1);
    }
    updateSlidersUI(config);
}

// --- Minimize/Restore logic ---
function minimizePanel() {
    controlPane.classList.add("minimized");
    setTimeout(() => {
        controlPane.style.display = "none";
        fab.style.display = "flex";
        fab.classList.add("show");
    }, 220);
}

function restorePanel() {
    fab.classList.remove("show");
    setTimeout(() => {
        fab.style.display = "none";
        controlPane.style.display = "flex";
        setTimeout(() => controlPane.classList.remove("minimized"), 5);
    }, 170);
}

function updateSlidersUI(config) {
    let slidersBox = document.getElementById("slidersBox");
    if (!slidersBox) {
        slidersBox = document.createElement("div");
        slidersBox.id = "slidersBox";
        slidersBox.style.margin = "16px 0";
        controlPane.appendChild(slidersBox);
    }
    slidersBox.innerHTML = "";

    (config.chromaKeys || []).forEach((ckey, idx) => {
        slidersBox.appendChild(makeSlider(
            `Chroma Similarity #${idx + 1}`,
            ckey.ckey_similarity,
            0.0,
            0.2,
            0.001,
            val => {
                currentFilter.chromaKeys[idx].ckey_similarity = parseFloat(val);
                setFilter(currentFilter);
            }
        ));
        slidersBox.appendChild(makeSlider(
            `Chroma Smoothness #${idx + 1}`,
            ckey.ckey_smoothness,
            0.0,
            100.0,
            0.1,
            val => {
                currentFilter.chromaKeys[idx].ckey_smoothness = parseFloat(val);
                setFilter(currentFilter);
            }
        ));
        slidersBox.appendChild(makeSlider(
            `Chroma Spill #${idx + 1}`,
            ckey.ckey_spill,
            0.0,
            400.0,
            1.0,
            val => {
                currentFilter.chromaKeys[idx].ckey_spill = parseFloat(val);
                setFilter(currentFilter);
            }
        ));
    });

    (config.colorCorrections || []).forEach((ccor, idx) => {
        slidersBox.appendChild(makeSlider(
            `Gamma #${idx + 1}`,
            ccor.gamma,
            -2.0,
            2.0,
            0.01,
            val => {
                currentFilter.colorCorrections[idx].gamma = parseFloat(val);
                setFilter(currentFilter);
            }
        ));
        slidersBox.appendChild(makeSlider(
            `Contrast #${idx + 1}`,
            ccor.contrast,
            -2.0,
            2.0,
            0.01,
            val => {
                currentFilter.colorCorrections[idx].contrast = parseFloat(val);
                setFilter(currentFilter);
            }
        ));
        slidersBox.appendChild(makeSlider(
            `Saturation #${idx + 1}`,
            ccor.saturation,
            0.0,
            4.0,
            0.01,
            val => {
                currentFilter.colorCorrections[idx].saturation = parseFloat(val);
                setFilter(currentFilter);
            }
        ));
    });
}

function makeSlider(label, value, min, max, step, onChange) {
    const wrapper = document.createElement("div");
    wrapper.style.marginBottom = "10px";
    const lbl = document.createElement("label");
    lbl.textContent = `${label}: `;
    lbl.style.fontSize = "0.96em";
    const valSpan = document.createElement("span");
    valSpan.textContent = value;
    lbl.appendChild(valSpan);

    const input = document.createElement("input");
    input.type = "range";
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = value;
    input.style.width = "100%";
    input.oninput = (e) => {
        valSpan.textContent = e.target.value;
        onChange(e.target.value);
    };
    wrapper.appendChild(lbl);
    wrapper.appendChild(input);
    return wrapper;
}

async function start() {
    if (welcomeWin) welcomeWin.style.display = "none";
    controlPane.style.display = "flex";
    controlPane.classList.remove("minimized");
    fab.classList.remove("show");
    fab.style.display = "none";

    canvas.style.display = "block";
    canvas.style.position = "relative";
    canvas.style.zIndex = "10";
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: 60, max: 60 }
      }
    });
    video.srcObject = stream;

    // Hide canvas and show welcomeWin when sharing stops
    stream.getVideoTracks()[0].addEventListener("ended", () => {
        canvas.style.display = "none";
        if (welcomeWin) welcomeWin.style.display = "flex";
    });

    const { videoTexture, checkVideoAspect } = await initGL();

    function render() {
        checkVideoAspect();

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, videoTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);

        if (lutEnabled) {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, lutTexture);
        }

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        requestAnimationFrame(render);
    }

    video.onloadedmetadata = () => {
        video.play().then(() => {
            render();
        });
        video.onloadedmetadata = null;
    };

    if (video.readyState >= 1) {
        video.play().then(() => {
            render();
        });
    }
}

const startBtn = document.getElementById("startBtn");
if (startBtn) startBtn.addEventListener("click", start);
const welcomeBtn = document.getElementById("welcomeBtn");
if (welcomeBtn) welcomeBtn.addEventListener("click", start);

if (minimizePanelBtn) minimizePanelBtn.addEventListener("click", minimizePanel);

if (fab) fab.addEventListener("click", restorePanel);

const filterBar = document.querySelector("#filterButtons");
filterBar.querySelectorAll(".lut-btn").forEach(btn => btn.remove());

filterConfigs.forEach((filter, idx) => {
    const btn = document.createElement("button");
    btn.className = "lut-btn";
    btn.setAttribute("data-filter", filter.id);
    btn.textContent = filter.name || filter.id;
    if (idx === 1) btn.classList.add("active"); // Blue as default
    btn.addEventListener("click", async () => {
        filterBar.querySelectorAll(".lut-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentFilter = JSON.parse(JSON.stringify(filter));
        currentLUT = currentFilter.lut;
        await setFilter(currentFilter);
    });
    filterBar.appendChild(btn);
});

currentFilter = JSON.parse(JSON.stringify(filterConfigs.find(f => f.id === "blue")));
currentLUT = currentFilter.lut;
setFilter(currentFilter);

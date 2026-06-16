const $ = (selector) => document.querySelector(selector);
const canvas = $("#game");
const ctx = canvas.getContext("2d");
const video = $("#webcam");
const homeVideo = $("#homeWebcam");
const handCanvas = $("#overlay");
const handCtx = handCanvas.getContext("2d");
const trackingCanvas = document.createElement("canvas");
const trackingCtx = trackingCanvas.getContext("2d", { willReadFrequently: true });
trackingCanvas.width = 160;
trackingCanvas.height = 120;

const GAMES = {
  catch: { title: "星际穿越", description: "在阶段倒计时内收集足够能量，避开越来越密集的陨石。", instruction: "在阶段时间结束前完成目标；移动食指收集能量与道具，生命最多三颗心。" },
  pinch: { title: "投篮高手", description: "从静止篮筐开始，逐阶段挑战不同运动方式。", instruction: "第一阶段篮筐静止；移动手掌拾取道具，瞄准篮筐后捏合手指投篮。" },
  reaction: { title: "丛林跳跃", description: "破解组合路段，跳跃、二段跳和冲刺穿越丛林。", instruction: "张开手掌跳跃，捏合冲刺；沿路线拾取守护符、疾风羽与时间果实。" },
  ocean: { title: "海底吞噬", description: "从小鱼开始吞噬成长，避开比你更大的深海猎手。", instruction: "移动手掌控制小鱼，吃掉比自己小的鱼来成长；本局没有限时，被大鱼咬到两次就失败，泡泡会提供短时护盾。" },
  rhythm: { title: "节奏守门", description: "跟随水晶音符做出指定手势，保持舞台能量。", instruction: "音符进入中央判定环时，做出张掌、握拳或捏合手势；连续命中建立乐章连击。" },
  tower: { title: "魔法守塔", description: "瞄准来袭魔物，使用捏合手势发射法术。", instruction: "移动手掌控制魔法准星，捏合发射法球；优先消灭靠近城堡的魔物。" },
};
const art = {};
["space-bg", "basketball-bg", "jungle-bg", "ocean-bg", "rhythm-bg", "tower-bg", "game-sprites"].forEach((name) => {
  art[name] = new Image();
  art[name].src = `./assets/${name}.png`;
});

let width = 1200, height = 680, activeGame = "catch", playing = false;
let cameraReady = false, cameraConnecting = false;
const ROUND_DURATION_SECONDS = 90;
const OCEAN_SHIELD_MS = 3800;
const OCEAN_SHIELD_MAX_MS = 5600;
let score = 0, lives = 3, timeLeft = ROUND_DURATION_SECONDS, items = [], particles = [], lastSpawn = 0;
let catchStageTime = 30, gameOverReason = "";
let cursor = { x: width / 2, y: height / 2 }, target = { ...cursor };
let handLandmarker, faceDetector, visionModule, stream, lastVideoTime = -1, gesture = "none", previousGesture = "none";
let learnedFingerColor = null, lastFingerPoint = null, fingerMissingFrames = 0;
let faceExclusion = null, lastFaceDetectionAt = 0;
let previousDiscoveryPixels = null;
let reactionTarget = "open", reactionChangedAt = 0, reactionLock = false;
let jungleY = 0, jungleVelocity = 0, lastJumpGesture = "none", jumpCount = 0, dashUntil = 0;
let combo = 0, multiplier = 1, stage = 1, stageProgress = 0, stageGoal = 10, shield = 0, screenShake = 0, flashAlpha = 0;
let calloutTimer = 0, calloutText = "", shotBall = null, hoop = null, lastPinchAt = 0, roundStartedAt = 0;
let maxCombo = 0;
let hoopMode = "横向巡航", junglePattern = "热身路段", lastPatternAt = 0;
let magnetUntil = 0, hoopSlowUntil = 0, wideHoopUntil = 0, jungleSlowUntil = 0, jungleGuard = 0, lastPowerupSpawn = 0;
let oxygen = 100, rhythmEnergy = 100, towerHealth = 100, rescued = 0, fishSize = 28, fishGrowth = 0, fishStreak = 0, fishShieldUntil = 0, fishDir = 1, lastFishX = 0, projectiles = [], lastActionAt = 0;
const HOOP_MODES = ["定点投篮", "横向巡航", "波浪升降", "环形绕场", "停顿假动作", "极速折返"];
const palette = ["#ffd263", "#ff6caf", "#a77bff", "#69e2b4"];
const appStats = JSON.parse(localStorage.getItem("gestureArcadeStats") || '{"games":0,"highScore":0,"stars":0}');
if (!localStorage.getItem("gestureArcadeZeroStarsMigration")) {
  appStats.stars = Math.max(0, (appStats.stars || 0) - 1280);
  localStorage.setItem("gestureArcadeZeroStarsMigration", "1");
}

function renderStats() {
  $("#starBalance").textContent = appStats.stars.toLocaleString("zh-CN");
  $("#profileStars").textContent = appStats.stars.toLocaleString("zh-CN");
}
function saveStats() { localStorage.setItem("gestureArcadeStats", JSON.stringify(appStats)); renderStats(); }
function ensureStatsShape() {
  appStats.games ||= 0; appStats.highScore ||= 0; appStats.stars ||= 0; appStats.bestStage ||= 1; appStats.maxCombo ||= 0;
  appStats.played ||= {}; appStats.achievements ||= {};
}
ensureStatsShape();
function setCameraCheckState(state, title, text) {
  const card = $("#homeCameraCheck");
  card.classList.toggle("checking", state === "checking"); card.classList.toggle("ready", state === "ready");
  $("#homeCameraTitle").textContent = title; $("#homeCameraText").textContent = text;
  $("#homeCameraSymbol").textContent = state === "ready" ? "✓" : state === "checking" ? "…" : "◎";
  card.querySelector("strong").textContent = state === "ready" ? "检测通过" : state === "checking" ? "识别中" : "开始检测";
}
function unlockGames() {
  cameraReady = true;
  document.querySelectorAll(".game-tab").forEach((tab) => { tab.disabled = false; tab.classList.remove("locked"); });
  setCameraCheckState("ready", "手掌识别通过", "摄像头与手势识别运行正常");
}
function lockGames() {
  cameraReady = false; playing = false;
  document.querySelectorAll(".game-tab").forEach((tab) => { tab.disabled = true; tab.classList.add("locked"); });
}

function resize() {
  const rect = canvas.getBoundingClientRect(), ratio = devicePixelRatio || 1;
  canvas.width = rect.width * ratio; canvas.height = rect.height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0); width = rect.width; height = rect.height;
}

function setScore(value) { score = value; $("#score").textContent = score; }
function oceanShieldSeconds(now = performance.now()) { return Math.max(0, (fishShieldUntil - now) / 1000); }
function updateMetric() {
  $("#metricLabel").textContent = activeGame === "catch" ? "生命 / 阶段时间" : activeGame === "ocean" ? "生命 / 体型" : activeGame === "rhythm" ? "舞台状态" : activeGame === "tower" ? "防线状态" : "剩余时间";
  const special = activeGame === "ocean" ? `${"♥ ".repeat(Math.max(0, lives)).trim()}  体型 ${Math.round(fishSize)}` : activeGame === "rhythm" ? `能量 ${Math.ceil(rhythmEnergy)}%` : activeGame === "tower" ? `城堡 ${Math.ceil(towerHealth)}%` : `${Math.ceil(timeLeft)}s`;
  $("#metric").textContent = activeGame === "catch" ? `${"♥ ".repeat(Math.max(0, lives)).trim()}  ${Math.ceil(catchStageTime)}s` : special;
}
function catchStageLimit() { return Math.max(20, 32 - (stage - 1) * 1.25); }
function difficultyName() {
  if (stage >= 9) return "大师";
  if (stage >= 6) return "困难";
  if (stage >= 3) return "进阶";
  return "入门";
}
function updateHud() {
  $("#comboValue").textContent = combo;
  $("#multiplierValue").textContent = `×${multiplier}`;
  $("#stageLabel").textContent = `阶段 ${stage} · ${difficultyName()}`;
  const now = performance.now();
  const labels = {
    catch: now < magnetUntil ? "磁力核心生效" : shield ? `护盾 ×${shield}` : "收集能量核心",
    pinch: now < wideHoopUntil ? "扩圈器生效" : now < hoopSlowUntil ? "稳定器生效" : hoopMode,
    reaction: jungleGuard ? `守护符 ×${jungleGuard}` : now < jungleSlowUntil ? "疾风羽生效" : now < dashUntil ? "冲刺状态" : junglePattern,
    ocean: oceanShieldSeconds(now) > 0 ? `泡泡护盾 ${oceanShieldSeconds(now).toFixed(1)}s` : `成长值 ${fishGrowth.toFixed(1)}/6`,
    rhythm: items[0] ? `准备：${gestureLabel(items[0].gesture)}` : "等待下一拍",
    tower: `敌人 ${items.length} · 法球 ${projectiles.length}`,
  };
  $("#missionLabel").textContent = labels[activeGame];
  $("#missionProgress").style.width = `${Math.min(100, stageProgress / stageGoal * 100)}%`;
}
function showCallout(text, color = "#fff") {
  calloutText = text; calloutTimer = performance.now() + 720;
  const element = $("#gameCallout"); element.textContent = text; element.style.color = color;
  element.classList.remove("hidden"); element.style.animation = "none"; void element.offsetWidth; element.style.animation = "";
}
function addScore(base, label = "") {
  const gained = base * multiplier; setScore(score + gained); combo++; stageProgress++;
  maxCombo = Math.max(maxCombo, combo);
  multiplier = combo >= 15 ? 4 : combo >= 8 ? 3 : combo >= 3 ? 2 : 1;
  if (label) showCallout(`${label}  +${gained}`, base >= 3 ? "#ffd36d" : "#fff");
  if (stageProgress >= stageGoal) {
    stage++; stageProgress = 0; stageGoal += activeGame === "catch" ? 2 : 5;
    if (activeGame === "catch") catchStageTime = catchStageLimit();
    if (activeGame === "pinch") hoopMode = HOOP_MODES[(stage - 1) % HOOP_MODES.length];
    showCallout(activeGame === "pinch" ? `${hoopMode} · ${difficultyName()}` : `阶段 ${stage} · ${difficultyName()}`, "#85f0ca");
  }
  updateHud();
}
function breakCombo(label = "连击中断") { combo = 0; multiplier = 1; showCallout(label, "#ff9aae"); updateHud(); }
function setStatus(text, type = "") { $("#status").textContent = text; $("#status").className = `status ${type}`; }
function setGesture(value) {
  previousGesture = gesture; gesture = value;
  $("#gestureName").textContent = ({ open: "张开手掌", fist: "握拳", pinch: "捏合", point: "移动手掌", none: "未检测到" })[value] || value;
}

function sampleFingerColor(point) {
  trackingCtx.drawImage(video, 0, 0, trackingCanvas.width, trackingCanvas.height);
  const x = Math.max(3, Math.min(trackingCanvas.width - 4, Math.round(point.x * trackingCanvas.width)));
  const y = Math.max(3, Math.min(trackingCanvas.height - 4, Math.round(point.y * trackingCanvas.height)));
  const patch = trackingCtx.getImageData(x - 3, y - 3, 7, 7).data;
  let r = 0, g = 0, b = 0, count = 0;
  for (let i = 0; i < patch.length; i += 4) {
    if (patch[i + 3] > 0) { r += patch[i]; g += patch[i + 1]; b += patch[i + 2]; count++; }
  }
  if (count) {
    const next = { r: r / count, g: g / count, b: b / count };
    learnedFingerColor = learnedFingerColor
      ? { r: learnedFingerColor.r * .8 + next.r * .2, g: learnedFingerColor.g * .8 + next.g * .2, b: learnedFingerColor.b * .8 + next.b * .2 }
      : next;
  }
}

function isInsideFace(x, y) {
  return faceExclusion
    && x >= faceExclusion.x
    && x <= faceExclusion.x + faceExclusion.width
    && y >= faceExclusion.y
    && y <= faceExclusion.y + faceExclusion.height;
}

function discoverSingleFinger() {
  trackingCtx.drawImage(video, 0, 0, trackingCanvas.width, trackingCanvas.height);
  const pixels = trackingCtx.getImageData(0, 0, trackingCanvas.width, trackingCanvas.height).data;
  if (!previousDiscoveryPixels) {
    previousDiscoveryPixels = new Uint8ClampedArray(pixels);
    return null;
  }
  const gridWidth = trackingCanvas.width / 2, gridHeight = trackingCanvas.height / 2;
  const mask = new Uint8Array(gridWidth * gridHeight);
  const visited = new Uint8Array(mask.length);

  for (let gy = 0; gy < gridHeight; gy++) {
    for (let gx = 0; gx < gridWidth; gx++) {
      const index = ((gy * 2) * trackingCanvas.width + gx * 2) * 4;
      if (isInsideFace((gx * 2) / trackingCanvas.width, (gy * 2) / trackingCanvas.height)) continue;
      const r = pixels[index], g = pixels[index + 1], b = pixels[index + 2];
      const motion = Math.abs(r - previousDiscoveryPixels[index])
        + Math.abs(g - previousDiscoveryPixels[index + 1])
        + Math.abs(b - previousDiscoveryPixels[index + 2]);
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (motion > 42 && r > 65 && r > g * 1.04 && r > b * 1.08 && max - min > 18) mask[gy * gridWidth + gx] = 1;
    }
  }

  let best = null;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    const queue = [start]; visited[start] = 1;
    let cursorIndex = 0, size = 0, sumX = 0, sumY = 0, minX = gridWidth, maxX = 0, minY = gridHeight, maxY = 0;
    while (cursorIndex < queue.length) {
      const current = queue[cursorIndex++], x = current % gridWidth, y = Math.floor(current / gridWidth);
      size++; sumX += x; sumY += y; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (const next of [current - 1, current + 1, current - gridWidth, current + gridWidth]) {
        if (next >= 0 && next < mask.length && mask[next] && !visited[next] && Math.abs((next % gridWidth) - x) <= 1) { visited[next] = 1; queue.push(next); }
      }
    }
    if (size < 8 || size > 190) continue;
    const componentWidth = maxX - minX + 1, componentHeight = maxY - minY + 1;
    const point = { x: (sumX / size * 2) / trackingCanvas.width, y: (sumY / size * 2) / trackingCanvas.height };
    const proximity = lastFingerPoint ? 1 - Math.min(1, Math.hypot(point.x - lastFingerPoint.x, point.y - lastFingerPoint.y) * 2) : 0;
    const fingerShape = Math.max(componentWidth, componentHeight) / Math.max(1, Math.min(componentWidth, componentHeight));
    if (fingerShape < 1.45 || (componentWidth > 18 && componentHeight > 18)) continue;
    const score = proximity * 5 + Math.min(4, fingerShape * 1.4) - size / 260;
    if (!best || score > best.score) best = { point, score };
  }
  previousDiscoveryPixels.set(pixels);
  if (best) sampleFingerColor(best.point);
  return best?.point || null;
}

function trackLearnedFinger() {
  if (!learnedFingerColor || !lastFingerPoint) return discoverSingleFinger();
  if (isInsideFace(lastFingerPoint.x, lastFingerPoint.y)) lastFingerPoint = null;
  if (!lastFingerPoint) return discoverSingleFinger();
  trackingCtx.drawImage(video, 0, 0, trackingCanvas.width, trackingCanvas.height);
  const pixels = trackingCtx.getImageData(0, 0, trackingCanvas.width, trackingCanvas.height).data;
  const centerX = lastFingerPoint.x * trackingCanvas.width, centerY = lastFingerPoint.y * trackingCanvas.height;
  const searchRadius = Math.min(70, 28 + fingerMissingFrames * 2);
  let sumX = 0, sumY = 0, weightSum = 0, matches = 0;

  for (let y = 1; y < trackingCanvas.height - 1; y += 2) {
    for (let x = 1; x < trackingCanvas.width - 1; x += 2) {
      const dx = x - centerX, dy = y - centerY, distance = Math.hypot(dx, dy);
      if (distance > searchRadius) continue;
      if (isInsideFace(x / trackingCanvas.width, y / trackingCanvas.height)) continue;
      const index = (y * trackingCanvas.width + x) * 4;
      const dr = pixels[index] - learnedFingerColor.r;
      const dg = pixels[index + 1] - learnedFingerColor.g;
      const db = pixels[index + 2] - learnedFingerColor.b;
      const colorDistance = Math.sqrt(dr * dr + dg * dg + db * db);
      if (colorDistance < 58) {
        const weight = Math.max(.1, 1 - distance / searchRadius) * Math.max(.1, 1 - colorDistance / 58);
        sumX += x * weight; sumY += y * weight; weightSum += weight; matches++;
      }
    }
  }
  if (matches < 7 || !weightSum) return null;
  const candidate = { x: sumX / weightSum / trackingCanvas.width, y: sumY / weightSum / trackingCanvas.height };
  if (isInsideFace(candidate.x, candidate.y) || Math.hypot(candidate.x - lastFingerPoint.x, candidate.y - lastFingerPoint.y) > .28) return null;
  return candidate;
}

function drawFingerMarker(point, fallback = false) {
  handCtx.strokeStyle = fallback ? "#ff78b7" : "#73edbd";
  handCtx.lineWidth = 5; handCtx.beginPath();
  handCtx.arc(point.x * handCanvas.width, point.y * handCanvas.height, fallback ? 19 : 16, 0, Math.PI * 2);
  handCtx.stroke();
}

function chooseGame(name) {
  activeGame = name; playing = false; items = []; particles = [];
  const game = GAMES[name];
  $("#gameDescription").textContent = game.instruction; $("#gamePageTitle").textContent = game.title;
  $("#welcomeTitle").textContent = game.title; $("#welcomeText").textContent = game.instruction;
  $("#trackingLabel").textContent = "识别手势";
  $("#gestureName").textContent = "等待手掌";
  $("#welcomeOverlay").classList.remove("hidden"); $("#gameOver").classList.add("hidden");
  setScore(0); lives = activeGame === "ocean" ? 2 : 3; timeLeft = ROUND_DURATION_SECONDS; catchStageTime = 32; combo = 0; multiplier = 1; stage = 1; stageProgress = 0; stageGoal = 10; updateMetric(); updateHud();
}
function showHome() {
  playing = false;
  $("#homeView").classList.remove("hidden"); $("#catalogView").classList.add("hidden"); $("#gameView").classList.add("hidden");
  $("#homeNav").classList.add("active"); $("#gamesNav").classList.remove("active");
  window.scrollTo(0, 0);
  requestAnimationFrame(() => window.scrollTo(0, 0));
}
function showGame(name = activeGame) {
  if (!cameraReady) { enableCamera(); return; }
  chooseGame(name);
  $("#homeView").classList.add("hidden"); $("#catalogView").classList.add("hidden"); $("#gameView").classList.remove("hidden");
  $("#homeNav").classList.remove("active"); $("#gamesNav").classList.add("active");
  window.scrollTo(0, 0);
  requestAnimationFrame(() => { window.scrollTo(0, 0); resize(); startGame(); });
}
function showCatalog() {
  playing = false;
  $("#homeView").classList.add("hidden"); $("#catalogView").classList.remove("hidden"); $("#gameView").classList.add("hidden");
  $("#homeNav").classList.remove("active"); $("#gamesNav").classList.add("active");
  window.scrollTo(0, 0);
  requestAnimationFrame(() => window.scrollTo(0, 0));
}

function startGame() {
  setScore(0); lives = activeGame === "ocean" ? 2 : 3; timeLeft = ROUND_DURATION_SECONDS; items = []; particles = []; lastSpawn = 0;
  reactionTarget = randomGesture(); reactionChangedAt = performance.now(); reactionLock = false;
  jungleY = 0; jungleVelocity = 0; lastJumpGesture = "none"; jumpCount = 0; dashUntil = 0;
  combo = 0; maxCombo = 0; multiplier = 1; stage = 1; stageProgress = 0; stageGoal = 10; shield = 0; screenShake = 0; flashAlpha = 0;
  catchStageTime = catchStageLimit(); gameOverReason = "";
  magnetUntil = 0; hoopSlowUntil = 0; wideHoopUntil = 0; jungleSlowUntil = 0; jungleGuard = 0; lastPowerupSpawn = performance.now();
  oxygen = 100; rhythmEnergy = 100; towerHealth = 100; rescued = 0; fishSize = 28; fishGrowth = 0; fishStreak = 0; fishShieldUntil = 0; fishDir = 1; lastFishX = cursor.x; projectiles = []; lastActionAt = 0;
  hoopMode = HOOP_MODES[0]; junglePattern = "热身路段"; lastPatternAt = 0;
  shotBall = null; lastPinchAt = 0; hoop = activeGame === "pinch" ? { x: width * .46, y: height * .35, vx: 1.3, radius: 54, phase: 0, modeStage: 1 } : null; roundStartedAt = performance.now();
  playing = true; $("#welcomeOverlay").classList.add("hidden"); $("#gameOver").classList.add("hidden"); updateMetric();
  updateHud(); showCallout("开始", "#85f0ca");
}
function endGame(reason = "") {
  gameOverReason = reason;
  playing = false; appStats.games++; appStats.highScore = Math.max(appStats.highScore, score); appStats.stars += score; appStats.bestStage = Math.max(appStats.bestStage || 1, stage); appStats.maxCombo = Math.max(appStats.maxCombo || 0, maxCombo); appStats.played ||= {}; appStats.played[activeGame] = true; saveStats();
  $("#finalScore").textContent = score; $("#resultSummary").textContent = `${reason ? `${reason} · ` : ""}完成阶段 ${stage} · 最高连击 ${maxCombo}`; $("#gameOver").classList.remove("hidden");
}

function randomGesture() { return ["open", "fist", "pinch"][Math.floor(Math.random() * 3)]; }
function gestureLabel(value) { return ({ open: "张开手掌", fist: "握拳", pinch: "捏合" })[value] || value; }
function spawn(kind = activeGame) {
  if (kind === "catch") {
    const roll = Math.random(), meteorChance = Math.min(.68, .1 + stage * .055);
    const type = roll < meteorChance ? "meteor" : roll < meteorChance + .05 ? "shield" : roll < meteorChance + .075 ? "magnet" : roll < meteorChance + .095 ? "repair" : roll < meteorChance + .25 ? "core" : "star";
    const x = 55 + Math.random() * (width - 330), speed = 2.6 + Math.random() * 1.7 + Math.min(stage, 12) * .27;
    const powerup = ["shield", "magnet", "repair"].includes(type);
    items.push({ type, powerup, x, baseX: x, y: -35, r: type === "meteor" ? 25 : type === "core" ? 20 : powerup ? 19 : 15, speed, vx: type === "meteor" && stage >= 3 ? (Math.random() - .5) * Math.min(3.2, stage * .34) : 0, wave: type === "meteor" && stage >= 6 ? Math.random() * 1.8 + .8 : 0, color: type === "meteor" ? "#ff667c" : type === "shield" ? "#75eec0" : type === "magnet" ? "#74d8ff" : type === "repair" ? "#ff89ae" : type === "core" ? "#ffd36d" : palette[Math.floor(Math.random() * 4)], rot: 0 });
    if (type === "meteor" && stage >= 3 && Math.random() < Math.min(.62, stage * .055)) {
      const pairX = Math.max(55, Math.min(width - 275, x + (Math.random() < .5 ? -115 : 115)));
      items.push({ type: "meteor", x: pairX, baseX: pairX, y: -105, r: 22, speed: speed * 1.04, vx: -Math.sign(pairX - x) * .7, wave: 0, color: "#ff667c", rot: 0 });
    }
  }
  if (kind === "reaction") {
    spawnJunglePattern();
  }
  if (kind === "ocean") {
    const roll = Math.random(), fromRight = Math.random() > .5;
    const predatorCount = items.filter((item) => item.type === "predator").length;
    const predatorCap = stage < 3 ? 1 : stage < 6 ? 2 : 3;
    const predatorChance = predatorCount >= predatorCap ? 0 : Math.min(.28, .1 + stage * .022);
    const type = roll < .12 ? "bubble" : roll < .19 ? "pearl" : roll < .19 + predatorChance ? "predator" : "fish";
    const edibleBias = .42 + Math.random() * .46, dangerBias = 1.12 + Math.random() * Math.min(.34, .18 + stage * .018);
    const sizeBias = type === "predator" ? dangerBias : edibleBias;
    const r = type === "bubble" ? 18 : type === "pearl" ? 15 : Math.max(12, Math.min(type === "predator" ? 82 : 58, fishSize * sizeBias));
    const color = type === "predator" ? "#ff647d" : type === "bubble" ? "#74e8ff" : type === "pearl" ? "#ffd36d" : palette[Math.floor(Math.random() * palette.length)];
    items.push({ type, x: fromRight ? width + 55 : -55, y: 100 + Math.random() * (height - 210), r, speed: 1.6 + stage * .18 + Math.random() * 1.1, dir: fromRight ? -1 : 1, phase: Math.random() * 6.2, color });
  }
  if (kind === "rhythm") {
    const lane = Math.floor(Math.random() * 3), gestures = ["open", "fist", "pinch"];
    items.push({ type: "note", gesture: gestures[lane], lane, x: width - 265, y: 170 + lane * 115, speed: 3.2 + stage * .36, judged: false });
  }
  if (kind === "tower") {
    const tough = stage >= 4 && Math.random() < .25, type = tough ? "brute" : Math.random() < .25 ? "swift" : "wisp";
    items.push({ type, x: -45, y: 115 + Math.random() * (height - 225), r: tough ? 31 : 23, speed: (type === "swift" ? 2.5 : 1.35) + stage * .18, hp: tough ? 3 : 1, maxHp: tough ? 3 : 1, phase: Math.random() * 6 });
  }
}
function jungleItem(type, offset, options = {}) {
  const powerup = ["guard", "feather", "timefruit"].includes(type);
  items.push({ type, powerup, x: width + 60 + offset, y: height - 105, r: options.r || (type === "tall" ? 43 : type === "orb" ? 18 : powerup ? 20 : type === "vine" ? 34 : 30), speed: 5.1 + Math.min(stage, 12) * .48, altitude: options.altitude || 0, airTier: options.airTier || "ground" });
}
function spawnJunglePattern() {
  const available = stage < 2 ? ["single", "arc"] : stage < 4 ? ["single", "arc", "double", "vine"] : stage < 7 ? ["arc", "double", "vine", "gauntlet"] : ["double", "vine", "gauntlet", "switchback"];
  const pattern = available[Math.floor(Math.random() * available.length)];
  if (pattern === "single") { junglePattern = "单障碍热身"; jungleItem(Math.random() < .35 ? "tall" : "log", 0); }
  if (pattern === "arc") {
    junglePattern = "能量弧线";
    jungleItem("log", 0); [35, 90, 145].forEach((offset, i) => jungleItem("orb", offset, { altitude: 65 + Math.sin(i / 2 * Math.PI) * 75 }));
  }
  if (pattern === "double") { junglePattern = "连续二段跳"; jungleItem("log", 0); jungleItem("tall", 190); }
  if (pattern === "vine") { junglePattern = "低姿穿越"; jungleItem("vine", 0, { altitude: 145 }); jungleItem("orb", 115, { altitude: 25 }); }
  if (pattern === "gauntlet") {
    junglePattern = "冲刺走廊";
    jungleItem("log", 0); jungleItem("log", 125); jungleItem("tall", 250); jungleItem("orb", 375, { altitude: 55 });
  }
  if (pattern === "switchback") {
    junglePattern = "高低切换";
    jungleItem("tall", 0); jungleItem("orb", 115, { altitude: 140 }); jungleItem("vine", 245, { altitude: 145 }); jungleItem("orb", 355, { altitude: 25 }); jungleItem("log", 470);
  }
  if (Math.random() < .65) {
    const roll = Math.random();
    const airTier = stage >= 3 && roll > .72 ? "double" : roll > .38 ? "jump" : "ground";
    const powerupAltitude = airTier === "double" ? 155 : airTier === "jump" ? 88 : 14;
    jungleItem(["guard", "feather", "timefruit"][Math.floor(Math.random() * 3)], 280 + Math.random() * 120, { altitude: powerupAltitude, airTier });
  }
  showCallout(junglePattern, "#85f0ca");
}
function burst(x, y, color) { for (let i = 0; i < 14; i++) particles.push({ x, y, color, vx: (Math.random() - .5) * 7, vy: (Math.random() - .5) * 7, life: 1 }); }
function activatePowerup(type, now) {
  const effects = {
    shield: () => { shield = Math.min(2, shield + 1); },
    magnet: () => { magnetUntil = now + 7000; },
    repair: () => { lives = Math.min(3, lives + 1); updateMetric(); },
    clock: () => { timeLeft += 8; updateMetric(); },
    stabilizer: () => { hoopSlowUntil = now + 7000; },
    wide: () => { wideHoopUntil = now + 7000; },
    guard: () => { jungleGuard = Math.min(2, jungleGuard + 1); },
    feather: () => { jungleSlowUntil = now + 6500; },
    timefruit: () => { timeLeft += 8; updateMetric(); },
  };
  const names = { shield: "能量护盾", magnet: "磁力核心", repair: "维修模块", clock: "时间沙漏", stabilizer: "稳定器", wide: "扩圈器", guard: "守护符", feather: "疾风羽", timefruit: "时间果实" };
  effects[type]?.(); showCallout(names[type], "#85f0ca"); updateHud();
}

function update(now, dt) {
  cursor.x += (target.x - cursor.x) * .2; cursor.y += (target.y - cursor.y) * .2;
  screenShake *= .86; flashAlpha *= .9;
  if (!playing) return;
  if (activeGame === "catch") { catchStageTime -= dt / 1000; updateMetric(); if (catchStageTime <= 0) return endGame("阶段挑战超时"); }
  else if (activeGame !== "ocean") { timeLeft -= dt / 1000; updateMetric(); if (timeLeft <= 0) return endGame(); }
  if (activeGame === "catch") updateCatch(now);
  if (activeGame === "pinch") updatePinch(now);
  if (activeGame === "reaction") updateReaction(now);
  if (activeGame === "ocean") updateOcean(now, dt);
  if (activeGame === "rhythm") updateRhythm(now);
  if (activeGame === "tower") updateTower(now);
  particles.forEach((p) => { p.x += p.vx; p.y += p.vy; p.vy += .1; p.life -= .025; });
  particles = particles.filter((p) => p.life > 0);
  updateHud();
}
function updateCatch(now) {
  if (now - lastSpawn > Math.max(230, 790 - stage * 52) && items.length < 20) { spawn(); lastSpawn = now; }
  items.forEach((item) => {
    if (now < magnetUntil && item.type !== "meteor" && !item.powerup) item.x += (cursor.x - item.x) * .035;
    item.y += item.speed; item.x += item.vx || 0; if (item.wave) item.x += Math.sin(item.y / 34) * item.wave; item.rot += item.type === "meteor" ? .07 : .035;
    const hit = item.y + item.r > height - 130 && item.y < height - 25 && Math.abs(item.x - cursor.x) < 72;
    if (hit) {
      item.dead = true; burst(item.x, item.y, item.color);
      if (item.type === "meteor") {
        if (shield > 0) { shield--; showCallout("护盾抵挡", "#75eec0"); }
        else { lives--; breakCombo("飞船受损"); screenShake = 15; flashAlpha = .45; updateMetric(); if (lives <= 0) endGame("飞船生命耗尽"); }
      } else if (item.powerup) { activatePowerup(item.type, now); addScore(1); }
      else if (item.type === "core") addScore(3, "稀有核心");
      else addScore(1);
    } else if (item.y > height + 35) {
      item.dead = true;
      if (item.type === "core") breakCombo("错过核心");
    }
  });
  items = items.filter((item) => !item.dead);
}
function updatePinch(now) {
  if (!hoop) hoop = { x: width * .46, y: height * .35, vx: 1.3, radius: 54, phase: 0, modeStage: stage };
  if (hoop.modeStage !== stage) { hoop.modeStage = stage; hoop.phase = now; }
  const t = (now - hoop.phase) / 1000, left = 145, right = width - 350, centerX = (left + right) / 2, range = (right - left) / 2;
  if (now - lastPowerupSpawn > Math.max(6500, 10500 - stage * 180)) {
    const types = ["clock", "stabilizer", "wide"], type = types[Math.floor(Math.random() * types.length)];
    items.push({ type, powerup: true, x: 150 + Math.random() * (width - 500), y: 135 + Math.random() * (height - 300), r: 22, born: now, color: type === "clock" ? "#ffd36d" : type === "stabilizer" ? "#74d8ff" : "#ff89ae" });
    lastPowerupSpawn = now;
  }
  items.forEach((item) => {
    item.y += Math.sin((now - item.born) / 320) * .18;
    if (Math.hypot(item.x - cursor.x, item.y - cursor.y) < item.r + 24) { item.dead = true; activatePowerup(item.type, now); }
    if (now - item.born > 9000) item.dead = true;
  });
  items = items.filter((item) => !item.dead);
  const slowFactor = now < hoopSlowUntil ? .55 : 1;
  const difficultySpeed = (1 + Math.min(stage - 1, 10) * .075) * slowFactor;
  hoop.radius = Math.max(32, 56 - stage * 2) + (now < wideHoopUntil ? 18 : 0);
  const mode = (stage - 1) % HOOP_MODES.length;
  if (mode === 0) { hoop.x = centerX; hoop.y = height * .31; }
  if (mode === 1) { hoop.x += hoop.vx * (1.2 + stage * .17) * slowFactor; if (hoop.x < left || hoop.x > right) { hoop.x = Math.max(left, Math.min(right, hoop.x)); hoop.vx *= -1; } hoop.y = height * .31; }
  if (mode === 2) { hoop.x = centerX + Math.sin(t * 1.7 * difficultySpeed) * range; hoop.y = height * .31 + Math.sin(t * 3.1 * difficultySpeed) * 88; }
  if (mode === 3) { hoop.x = centerX + Math.sin(t * 2.05 * difficultySpeed) * range; hoop.y = height * .31 + Math.sin(t * 4.1 * difficultySpeed) * 92; }
  if (mode === 4) {
    const adjustedT = t * difficultySpeed, cycle = adjustedT % 3.2, direction = Math.floor(adjustedT / 3.2) % 2 ? -1 : 1;
    hoop.x = cycle < 1.15 ? centerX + direction * range * cycle / 1.15 : cycle < 2 ? centerX + direction * range : centerX + direction * range * (1 - (cycle - 2) / 1.2);
    hoop.y = height * .31 + Math.sin(t * 1.8) * 42;
  }
  if (mode === 5) { hoop.x = centerX + Math.sin(t * 3.8 * difficultySpeed) * range; hoop.y = height * .31 + Math.sin(t * 5.6 * difficultySpeed) * 65; }
  if (gesture === "pinch" && previousGesture !== "pinch" && now - lastPinchAt > 300 && !shotBall) {
    lastPinchAt = now; const distance = Math.hypot(hoop.x - cursor.x, hoop.y - cursor.y);
    shotBall = { x: cursor.x, y: height - 65, tx: hoop.x, ty: hoop.y, progress: 0, distance };
  }
  if (shotBall) {
    shotBall.progress += .055;
    if (shotBall.progress >= 1) {
      const accuracy = shotBall.distance;
      if (accuracy < hoop.radius * .52) { addScore(4, "PERFECT"); timeLeft += 1.5; burst(hoop.x, hoop.y, "#ffd36d"); }
      else if (accuracy < hoop.radius * 1.28) { addScore(2, "GOOD"); burst(hoop.x, hoop.y, "#75eec0"); }
      else { breakCombo("投篮偏出"); timeLeft = Math.max(0, timeLeft - 1.5); }
      shotBall = null;
    }
  }
}
function updateReaction(now) {
  if (now - lastSpawn > Math.max(1150, 2700 - stage * 145)) { spawn("reaction"); lastSpawn = now; }
  if (gesture === "open" && lastJumpGesture !== "open" && jumpCount < 2) { jungleVelocity = jumpCount ? -10 : -13; jumpCount++; showCallout(jumpCount === 2 ? "二段跳" : "跳跃", "#85f0ca"); }
  if (gesture === "pinch" && previousGesture !== "pinch" && now > dashUntil) { dashUntil = now + Math.max(620, 880 - stage * 22); showCallout("冲刺", "#ffd36d"); }
  lastJumpGesture = gesture;
  jungleVelocity += .65; jungleY = Math.max(0, jungleY - jungleVelocity);
  if (jungleY === 0 && jungleVelocity > 0) { jungleVelocity = 0; jumpCount = 0; }
  items.forEach((obstacle) => {
    obstacle.x -= obstacle.speed * (now < dashUntil ? 1.8 : 1) * (now < jungleSlowUntil ? .62 : 1);
    if (obstacle.powerup && obstacle.x < 215 && obstacle.x > 60 && Math.abs(jungleY - obstacle.altitude) < (obstacle.airTier === "ground" ? 62 : 55)) { obstacle.dead = true; activatePowerup(obstacle.type, now); addScore(obstacle.airTier === "double" ? 3 : obstacle.airTier === "jump" ? 2 : 1, obstacle.airTier === "double" ? "高空道具" : obstacle.airTier === "jump" ? "空中道具" : ""); burst(140, height - 105 - obstacle.altitude, "#85f0ca"); }
    if (obstacle.type === "orb" && obstacle.x < 185 && obstacle.x > 85 && Math.abs(jungleY - obstacle.altitude) < Math.max(42, 72 - stage * 3)) { obstacle.dead = true; addScore(3, "能量核心"); timeLeft += 1; burst(140, height - 105 - obstacle.altitude, "#ffd36d"); }
    if (!obstacle.powerup && obstacle.type !== "orb" && !obstacle.scored && obstacle.x < 105) { obstacle.scored = true; addScore(now < dashUntil ? 3 : 1, now < dashUntil ? "冲刺穿越" : ""); }
    const groundCollision = !obstacle.powerup && obstacle.type !== "vine" && obstacle.type !== "orb" && obstacle.x < 175 && obstacle.x > 95 && jungleY < obstacle.r * 1.45;
    const vineCollision = obstacle.type === "vine" && obstacle.x < 180 && obstacle.x > 90 && jungleY > 65 && now > dashUntil;
    if (groundCollision || vineCollision) {
      obstacle.dead = true;
      if (jungleGuard) { jungleGuard--; showCallout("守护符抵挡", "#85f0ca"); }
      else { timeLeft = Math.max(0, timeLeft - 5); breakCombo(vineCollision ? "撞上藤蔓" : "撞上障碍"); screenShake = 13; flashAlpha = .35; }
      burst(140, height - 100, "#ff8f70");
    }
    if (obstacle.x < -50) obstacle.dead = true;
  });
  items = items.filter((item) => !item.dead);
}
function updateOcean(now, dt) {
  if (fishShieldUntil && now >= fishShieldUntil) fishShieldUntil = 0;
  const fishDelta = cursor.x - lastFishX;
  if (Math.abs(fishDelta) > 1.8) fishDir = fishDelta > 0 ? 1 : -1;
  lastFishX = cursor.x;
  if (now - lastSpawn > Math.max(360, 920 - stage * 48)) { spawn("ocean"); lastSpawn = now; }
  items.forEach((item) => {
    item.x += item.speed * item.dir; item.y += Math.sin(now / 430 + item.phase) * .38;
    const playerRadius = fishSize * .92;
    const hit = Math.hypot(item.x - cursor.x, item.y - cursor.y) < item.r + playerRadius * .75;
    if (hit) {
      item.dead = true; burst(item.x, item.y, item.color);
      if (item.type === "bubble") {
        const baseUntil = Math.max(now, fishShieldUntil);
        fishShieldUntil = Math.min(now + OCEAN_SHIELD_MAX_MS, baseUntil + OCEAN_SHIELD_MS);
        addScore(1, "泡泡护盾");
      }
      else if (item.type === "pearl") { fishGrowth += 1.8; addScore(4, "深海珍珠"); }
      else if (item.r <= fishSize * 1.02) {
        fishStreak++; fishGrowth += item.type === "predator" ? 2.4 : Math.max(.55, item.r * .026); addScore(item.type === "predator" ? 5 : 2, item.type === "predator" ? "反吞猎手" : "吞噬成长");
        while (fishGrowth >= 6 && fishSize < 72) { fishGrowth -= 6; fishSize += 1; showCallout("体型成长", "#85f0ca"); }
      } else if (oceanShieldSeconds(now) > 0) {
        fishShieldUntil = 0; breakCombo("泡泡护盾抵挡"); screenShake = 8;
      } else {
        lives--; fishStreak = 0; fishGrowth = Math.max(0, fishGrowth - 2); fishSize = Math.max(24, fishSize - item.r * .055); breakCombo("被大鱼咬伤"); screenShake = 15; flashAlpha = .38;
        if (lives <= 0) endGame("被大鱼吞掉");
      }
    }
    if (item.x < -70 || item.x > width + 70) item.dead = true;
  });
  items = items.filter((item) => !item.dead); updateMetric();
}
function updateRhythm(now) {
  if (now - lastSpawn > Math.max(520, 1250 - stage * 65)) { spawn("rhythm"); lastSpawn = now; }
  const judgeX = 270;
  items.forEach((note) => {
    note.x -= note.speed;
    const inWindow = Math.abs(note.x - judgeX) < 42;
    if (!note.judged && inWindow && gesture === note.gesture && previousGesture !== gesture) {
      note.judged = true; note.dead = true; rhythmEnergy = Math.min(100, rhythmEnergy + 5); addScore(Math.abs(note.x - judgeX) < 18 ? 4 : 2, Math.abs(note.x - judgeX) < 18 ? "PERFECT" : "GOOD"); burst(judgeX, note.y, "#ffd36d");
    } else if (!note.judged && note.x < judgeX - 52) {
      note.judged = true; note.dead = true; rhythmEnergy -= 15; breakCombo("错过节拍"); screenShake = 8;
    }
  });
  if (rhythmEnergy <= 0) return endGame("舞台能量耗尽");
  items = items.filter((item) => !item.dead); updateMetric();
}
function updateTower(now) {
  if (now - lastSpawn > Math.max(500, 1350 - stage * 75)) { spawn("tower"); lastSpawn = now; }
  if (gesture === "pinch" && previousGesture !== "pinch" && now - lastActionAt > 220) {
    lastActionAt = now; const sx = width - 285, sy = height * .52, dx = cursor.x - sx, dy = cursor.y - sy, length = Math.max(1, Math.hypot(dx, dy));
    projectiles.push({ x: sx, y: sy, vx: dx / length * 10, vy: dy / length * 10, life: 100 }); showCallout("施放", "#85f0ca");
  }
  projectiles.forEach((bolt) => { bolt.x += bolt.vx; bolt.y += bolt.vy; bolt.life--; });
  items.forEach((enemy) => {
    enemy.x += enemy.speed; enemy.y += Math.sin(now / 420 + enemy.phase) * .3;
    projectiles.forEach((bolt) => {
      if (!bolt.dead && Math.hypot(bolt.x - enemy.x, bolt.y - enemy.y) < enemy.r + 8) {
        bolt.dead = true; enemy.hp--; burst(enemy.x, enemy.y, "#a98aff");
        if (enemy.hp <= 0) { enemy.dead = true; addScore(enemy.maxHp === 3 ? 4 : 2, enemy.maxHp === 3 ? "击破重甲" : "魔物击破"); }
      }
    });
    if (enemy.x > width - 305) { enemy.dead = true; towerHealth -= enemy.maxHp === 3 ? 22 : 12; breakCombo("城堡受损"); screenShake = 12; flashAlpha = .35; }
  });
  projectiles = projectiles.filter((bolt) => !bolt.dead && bolt.life > 0 && bolt.x > 0 && bolt.x < width && bolt.y > 0 && bolt.y < height);
  items = items.filter((enemy) => !enemy.dead); updateMetric();
  if (towerHealth <= 0) endGame("天空城堡失守");
}

function drawCover(image) {
  if (!image.complete || !image.naturalWidth) return false;
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
  ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
  return true;
}
function drawSprite(sx, sy, sw, sh, dx, dy, dw, dh) {
  if (art["game-sprites"].complete && art["game-sprites"].naturalWidth) ctx.drawImage(art["game-sprites"], sx, sy, sw, sh, dx, dy, dw, dh);
}
function background() {
  const backgrounds = { catch: "space-bg", pinch: "basketball-bg", reaction: "jungle-bg", ocean: "ocean-bg", rhythm: "rhythm-bg", tower: "tower-bg" };
  const image = art[backgrounds[activeGame] || "space-bg"];
  if (!drawCover(image)) { ctx.fillStyle = "#17122e"; ctx.fillRect(0, 0, width, height); }
  const shade = ctx.createLinearGradient(0, 0, 0, height); shade.addColorStop(0, "#09051b25"); shade.addColorStop(1, "#09051b70"); ctx.fillStyle = shade; ctx.fillRect(0, 0, width, height);
}
function drawStar(x, y, r, rot, color) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.beginPath();
  for (let i = 0; i < 10; i++) { const radius = i % 2 ? r * .45 : r, angle = -Math.PI / 2 + i * Math.PI / 5; ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius); }
  ctx.closePath(); ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 18; ctx.fill(); ctx.restore();
}
function drawPowerup(item, now) {
  const symbols = { shield: "S", magnet: "M", repair: "+", clock: "+8", stabilizer: "||", wide: "O", guard: "S", feather: ">>", timefruit: "+8" };
  const colors = { shield: "#75eec0", magnet: "#74d8ff", repair: "#ff89ae", clock: "#ffd36d", stabilizer: "#74d8ff", wide: "#ff89ae", guard: "#75eec0", feather: "#74d8ff", timefruit: "#ffd36d" };
  const color = colors[item.type] || item.color || "#fff", pulse = 1 + Math.sin(now / 180) * .08;
  ctx.save(); ctx.translate(item.x, item.y); ctx.scale(pulse, pulse); ctx.rotate(now / 1800);
  ctx.fillStyle = `${color}33`; ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.shadowColor = color; ctx.shadowBlur = 22;
  ctx.beginPath(); ctx.arc(0, 0, item.r + 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.rotate(-now / 1800);
  ctx.fillStyle = "#fff"; ctx.font = `900 ${item.type === "clock" || item.type === "timefruit" ? 11 : 16}px -apple-system`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(symbols[item.type] || "+", 0, 1);
  ctx.restore();
}
function drawOrb(x, y, r, color, core = "#fff") {
  const glow = ctx.createRadialGradient(x - r * .25, y - r * .3, 2, x, y, r * 1.5);
  glow.addColorStop(0, core); glow.addColorStop(.35, color); glow.addColorStop(1, "transparent");
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, r * 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = color; ctx.strokeStyle = "#ffffffaa"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
}
function drawFish(x, y, r, color, dir = 1, danger = false) {
  ctx.save(); ctx.translate(x, y); ctx.scale(dir, 1);
  ctx.shadowColor = color; ctx.shadowBlur = danger ? 24 : 16;
  const body = ctx.createLinearGradient(-r, -r, r, r);
  body.addColorStop(0, "#ffffffcc"); body.addColorStop(.35, color); body.addColorStop(1, danger ? "#6d1936" : "#12566f");
  ctx.fillStyle = body; ctx.strokeStyle = "#ffffffb5"; ctx.lineWidth = Math.max(2, r * .08);
  ctx.beginPath(); ctx.ellipse(0, 0, r * 1.35, r * .78, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(-r * 1.22, 0); ctx.lineTo(-r * 1.92, -r * .58); ctx.lineTo(-r * 1.82, r * .58); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(r * .58, -r * .18, Math.max(3, r * .14), 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#23183e"; ctx.beginPath(); ctx.arc(r * .62, -r * .18, Math.max(1.5, r * .06), 0, Math.PI * 2); ctx.fill();
  if (danger) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(r * .75, -r * .22 + i * r * .17); ctx.lineTo(r * 1.04, -r * .12 + i * r * .12); ctx.stroke(); } }
  ctx.restore();
}
function draw(now) {
  ctx.save();
  if (screenShake > .5) ctx.translate((Math.random() - .5) * screenShake, (Math.random() - .5) * screenShake);
  background();
  if (activeGame === "catch") {
    items.forEach((item) => {
      if (item.type === "meteor") {
        ctx.save(); ctx.translate(item.x, item.y); ctx.rotate(item.rot); ctx.fillStyle = "#44233f"; ctx.strokeStyle = item.color; ctx.lineWidth = 4; ctx.shadowColor = item.color; ctx.shadowBlur = 18; ctx.beginPath();
        for (let i = 0; i < 9; i++) { const a = i * Math.PI * 2 / 9, r = item.r * (.72 + Math.random() * .28); ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
      } else if (item.powerup) drawPowerup(item, now);
      else drawStar(item.x, item.y, item.r, item.rot, item.color);
    });
    const glow = ctx.createRadialGradient(cursor.x, height - 42, 0, cursor.x, height - 42, 150); glow.addColorStop(0, "#a98aff3d"); glow.addColorStop(1, "transparent"); ctx.fillStyle = glow; ctx.fillRect(cursor.x - 160, height - 180, 320, 180);
    ctx.shadowColor = "#70dfff"; ctx.shadowBlur = 24; drawSprite(170, 0, 610, 455, cursor.x - 77, height - 142, 154, 115); ctx.shadowBlur = 0;
    if (shield) { ctx.strokeStyle = "#75eec0"; ctx.lineWidth = 3; ctx.globalAlpha = .6 + Math.sin(now / 140) * .18; ctx.beginPath(); ctx.ellipse(cursor.x, height - 82, 92, 66, 0, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
  }
  if (activeGame === "pinch" && hoop) {
    items.forEach((item) => drawPowerup(item, now));
    ctx.fillStyle = "#ffffffdd"; ctx.font = "800 13px -apple-system"; ctx.fillText(`篮筐模式：${hoopMode}`, 24, height - 28);
    ctx.strokeStyle = "#ffca68"; ctx.lineWidth = 8; ctx.shadowColor = "#ff9c55"; ctx.shadowBlur = 20; ctx.beginPath(); ctx.ellipse(hoop.x, hoop.y, hoop.radius, 27, 0, 0, Math.PI * 2); ctx.stroke(); ctx.shadowBlur = 0;
    ctx.strokeStyle = "#ffffff99"; ctx.lineWidth = 2; for (let i = -38; i <= 38; i += 19) { ctx.beginPath(); ctx.moveTo(hoop.x + i, hoop.y + 20); ctx.lineTo(hoop.x + i * .5, hoop.y + 70); ctx.stroke(); }
    const aimDistance = Math.hypot(hoop.x - cursor.x, hoop.y - cursor.y); ctx.strokeStyle = aimDistance < hoop.radius * .52 ? "#ffd36d" : aimDistance < hoop.radius * 1.28 ? "#75eec0" : "#ffffffaa"; ctx.lineWidth = 3; ctx.setLineDash([6, 8]); ctx.beginPath(); ctx.moveTo(cursor.x, cursor.y); ctx.lineTo(hoop.x, hoop.y); ctx.stroke(); ctx.setLineDash([]);
    if (shotBall) { const p = Math.min(1, shotBall.progress), x = shotBall.x + (shotBall.tx - shotBall.x) * p, y = shotBall.y + (shotBall.ty - shotBall.y) * p - Math.sin(p * Math.PI) * 150; drawSprite(985, 40, 390, 390, x - 22, y - 22, 44, 44); }
  }
  if (activeGame === "reaction") {
    const ground = height - 92;
    if (now < dashUntil) { ctx.globalAlpha = .2; for (let i = 1; i <= 4; i++) drawSprite(190, 430, 520, 500, 82 - i * 28, ground - 112 - jungleY, 125, 120); ctx.globalAlpha = 1; }
    drawSprite(190, 430, 520, 500, 82, ground - 112 - jungleY, 125, 120);
    items.forEach((o) => {
      if (o.powerup) {
        drawPowerup({ ...o, y: ground - o.altitude }, now);
        if (o.airTier !== "ground") {
          ctx.fillStyle = "#ffffffcc"; ctx.font = "800 11px -apple-system"; ctx.textAlign = "center";
          ctx.fillText(o.airTier === "double" ? "二段跳" : "跳跃获取", o.x, ground - o.altitude - 34); ctx.textAlign = "start";
        }
      }
      else if (o.type === "orb") drawStar(o.x, ground - o.altitude, o.r, now / 500, "#ffd36d");
      else if (o.type === "vine") {
        ctx.strokeStyle = "#64b86e"; ctx.lineWidth = 10; ctx.shadowColor = "#1f5c32"; ctx.shadowBlur = 8; ctx.beginPath(); ctx.moveTo(o.x, 0); ctx.bezierCurveTo(o.x - 30, 85, o.x + 25, ground - o.altitude - 30, o.x, ground - o.altitude); ctx.stroke(); ctx.shadowBlur = 0;
        ctx.fillStyle = "#8bd47d"; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.ellipse(o.x + (i % 2 ? 12 : -12), 90 + i * 45, 14, 7, i % 2 ? .5 : -.5, 0, Math.PI * 2); ctx.fill(); }
      } else drawSprite(820, 470, 700, 360, o.x - o.r, ground - o.r * 1.4, o.r * (o.type === "tall" ? 2.2 : 2.8), o.r * (o.type === "tall" ? 2 : 1.45));
    });
    ctx.fillStyle = "#fff"; ctx.font = "700 13px -apple-system"; ctx.fillText(`路线：${junglePattern} · 跳跃 ${jumpCount}/2 · 捏合冲刺`, 24, 34);
  }
  if (activeGame === "ocean") {
    items.forEach((item) => {
      if (item.type === "fish" || item.type === "predator") drawFish(item.x, item.y, item.r, item.color, item.dir, item.r > fishSize * 1.02);
      else drawPowerup({ ...item, type: item.type === "bubble" ? "stabilizer" : "timefruit" }, now);
    });
    drawFish(cursor.x, cursor.y, fishSize, "#75eec0", fishDir, false);
    const shieldSeconds = oceanShieldSeconds(now);
    if (shieldSeconds > 0) { ctx.strokeStyle = "#74e8ff"; ctx.lineWidth = 3; ctx.globalAlpha = .42 + Math.min(.28, shieldSeconds / 8); ctx.beginPath(); ctx.arc(cursor.x, cursor.y, fishSize * 1.55, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
    ctx.fillStyle = "#fff"; ctx.font = "800 13px -apple-system"; ctx.fillText(`生命 ${"♥".repeat(Math.max(0, lives))} · 体型 ${Math.round(fishSize)} · 成长 ${fishGrowth.toFixed(1)}/6 · 护盾 ${shieldSeconds.toFixed(1)}s`, 24, height - 28);
  }
  if (activeGame === "rhythm") {
    const judgeX = 270, labels = ["张掌", "握拳", "捏合"], colors = ["#85f0ca", "#ff89ae", "#ffd36d"];
    for (let i = 0; i < 3; i++) { const y = 170 + i * 115; ctx.strokeStyle = `${colors[i]}55`; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(judgeX, y); ctx.lineTo(width - 250, y); ctx.stroke(); ctx.fillStyle = "#ffffffcc"; ctx.font = "800 12px -apple-system"; ctx.fillText(labels[i], judgeX - 80, y + 4); }
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 5; ctx.shadowColor = "#a98aff"; ctx.shadowBlur = 25;
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(judgeX, 170 + i * 115, 34, 0, Math.PI * 2); ctx.stroke(); } ctx.shadowBlur = 0;
    items.forEach((note) => { drawOrb(note.x, note.y, 22, colors[note.lane]); ctx.fillStyle = "#22163e"; ctx.font = "900 10px -apple-system"; ctx.textAlign = "center"; ctx.fillText(labels[note.lane], note.x, note.y + 4); ctx.textAlign = "start"; });
    ctx.fillStyle = "#fff"; ctx.font = "800 13px -apple-system"; ctx.fillText(`当前手势：${gestureLabel(gesture)} · 舞台能量 ${Math.ceil(rhythmEnergy)}%`, 24, height - 28);
  }
  if (activeGame === "tower") {
    const castleX = width - 285, castleY = height * .52;
    ctx.fillStyle = "#7254d8"; ctx.strokeStyle = "#ffe4a3"; ctx.lineWidth = 4; ctx.shadowColor = "#a98aff"; ctx.shadowBlur = 28; ctx.fillRect(castleX - 42, castleY - 65, 84, 130); ctx.strokeRect(castleX - 42, castleY - 65, 84, 130); ctx.shadowBlur = 0;
    items.forEach((enemy) => { drawOrb(enemy.x, enemy.y, enemy.r, enemy.type === "brute" ? "#ff6d83" : enemy.type === "swift" ? "#ffd36d" : "#a98aff", "#2a1748"); if (enemy.maxHp > 1) { ctx.fillStyle = "#251943"; ctx.fillRect(enemy.x - 24, enemy.y - enemy.r - 13, 48, 5); ctx.fillStyle = "#ff758c"; ctx.fillRect(enemy.x - 24, enemy.y - enemy.r - 13, 48 * enemy.hp / enemy.maxHp, 5); } });
    projectiles.forEach((bolt) => drawOrb(bolt.x, bolt.y, 8, "#74e8ff"));
    ctx.strokeStyle = "#ffffffbb"; ctx.lineWidth = 2; ctx.setLineDash([5, 7]); ctx.beginPath(); ctx.moveTo(castleX, castleY); ctx.lineTo(cursor.x, cursor.y); ctx.stroke(); ctx.setLineDash([]); drawOrb(cursor.x, cursor.y, 13, gesture === "pinch" ? "#ffd36d" : "#85f0ca");
    ctx.fillStyle = "#fff"; ctx.font = "800 13px -apple-system"; ctx.fillText(`城堡耐久 ${Math.ceil(towerHealth)}% · 捏合施法`, 24, height - 28);
  }
  ctx.globalAlpha = 1; particles.forEach((p) => { ctx.globalAlpha = p.life; ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, 4, 4); }); ctx.globalAlpha = 1;
  if (activeGame === "pinch") { ctx.strokeStyle = gesture === "pinch" ? "#69e2b4" : "#fff"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cursor.x, cursor.y, gesture === "pinch" ? 15 : 27, 0, Math.PI * 2); ctx.stroke(); drawSprite(985, 40, 390, 390, cursor.x - 17, cursor.y - 17, 34, 34); }
  if (flashAlpha > .01) { ctx.fillStyle = `rgba(255,80,110,${flashAlpha})`; ctx.fillRect(0, 0, width, height); }
  ctx.restore();
}

let previousTime = performance.now();
function loop(now) { const dt = Math.min(50, now - previousTime); previousTime = now; update(now, dt); draw(now); detectHands(); requestAnimationFrame(loop); }

async function getVision() {
  if (!visionModule) visionModule = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/vision_bundle.mjs");
  return visionModule;
}
async function createHandLandmarker(delegate) {
  const vision = await getVision(), fileset = await vision.FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm");
  return vision.HandLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task", delegate }, runningMode: "VIDEO", numHands: 1, minHandDetectionConfidence: .5, minTrackingConfidence: .5 });
}
async function createFaceDetector(delegate) {
  const vision = await getVision(), fileset = await vision.FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm");
  return vision.FaceDetector.createFromOptions(fileset, { baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite", delegate }, runningMode: "VIDEO", minDetectionConfidence: .5 });
}
async function enableCamera() {
  if (cameraConnecting) return;
  if (!navigator.mediaDevices?.getUserMedia) return cameraFailure(new Error("当前页面不是安全上下文。请通过 http://localhost:4173 打开。"));
  lockGames();
  cameraConnecting = true; setCameraCheckState("checking", "正在连接摄像头", "连接后请将完整手掌放入画面");
  setStatus("请求权限…"); $("#cameraError").textContent = "正在请求 macOS 摄像头权限…";
  try {
    stream?.getTracks().forEach((track) => track.stop());
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    video.srcObject = stream; homeVideo.srcObject = stream; await Promise.all([video.play(), homeVideo.play()]); handCanvas.width = video.videoWidth; handCanvas.height = video.videoHeight;
    $("#cameraPlaceholder").classList.add("hidden"); setStatus("加载识别器…");
    if (!handLandmarker || !faceDetector) {
      try { handLandmarker = await createHandLandmarker("GPU"); faceDetector = await createFaceDetector("GPU"); }
      catch { handLandmarker = await createHandLandmarker("CPU"); faceDetector = await createFaceDetector("CPU"); }
    }
    setStatus("请举起手掌", "active"); $("#cameraButton").textContent = "重新检测摄像头"; $("#cameraError").textContent = "摄像头已连接，正在等待完整手掌。";
    setCameraCheckState("checking", "请举起完整手掌", "识别成功后会自动解锁游戏");
  } catch (error) { cameraFailure(error); }
  finally { cameraConnecting = false; }
}
function cameraFailure(error) {
  console.error(error); lockGames(); setStatus("连接失败", "error");
  const messages = { NotAllowedError: "摄像头权限被拒绝。请在 macOS“系统设置 → 隐私与安全性 → 摄像头”中允许浏览器，然后重新打开浏览器。", NotFoundError: "没有检测到摄像头。", NotReadableError: "摄像头可能正被 FaceTime、Zoom 或其他应用占用。", OverconstrainedError: "摄像头不支持请求的视频格式。" };
  $("#cameraError").textContent = messages[error.name] || `错误：${error.message || error.name || "未知错误"}`;
  setCameraCheckState("error", "摄像头检测失败", $("#cameraError").textContent);
  openCameraHelp();
}
function classify(hand) {
  const distance = (a, b) => Math.hypot(hand[a].x - hand[b].x, hand[a].y - hand[b].y);
  if (distance(4, 8) < .055) return "pinch";
  const extended = [[8, 6], [12, 10], [16, 14], [20, 18]].filter(([tip, joint]) => distance(tip, 0) > distance(joint, 0) * 1.12).length;
  if (extended >= 3) return "open"; if (extended <= 1) return "fist"; return "point";
}
function updateFaceExclusion(timestamp) {
  if (!faceDetector || timestamp - lastFaceDetectionAt < 160) return;
  lastFaceDetectionAt = timestamp;
  const detection = faceDetector.detectForVideo(video, timestamp).detections?.[0];
  if (!detection?.boundingBox) { faceExclusion = null; return; }
  const box = detection.boundingBox;
  const paddingX = box.width * .35, paddingY = box.height * .28;
  faceExclusion = {
    x: Math.max(0, (box.originX - paddingX) / video.videoWidth),
    y: Math.max(0, (box.originY - paddingY) / video.videoHeight),
    width: Math.min(1, (box.width + paddingX * 2) / video.videoWidth),
    height: Math.min(1, (box.height + paddingY * 2) / video.videoHeight),
  };
}
function detectHands() {
  if (!handLandmarker || video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime; handCtx.clearRect(0, 0, handCanvas.width, handCanvas.height);
  const timestamp = performance.now(); updateFaceExclusion(timestamp);
  const result = handLandmarker.detectForVideo(video, timestamp);
  if (!result.landmarks?.length) {
    if (!cameraReady) {
      setGesture("none"); setStatus("请展示完整手掌", "active");
      setCameraCheckState("checking", "正在寻找完整手掌", "请退后一点，让五根手指都进入画面");
      return;
    }
    if (activeGame === "catch") {
      fingerMissingFrames++;
      const tracked = trackLearnedFinger() || discoverSingleFinger();
      if (tracked) {
        lastFingerPoint = tracked; target.x = (1 - tracked.x) * width; target.y = tracked.y * height;
        $("#gestureName").textContent = "仅追踪指尖"; setStatus("单指已锁定", "active"); drawFingerMarker(tracked, true); return;
      }
      $("#gestureName").textContent = "移动单指以便发现";
      setStatus("寻找单指", "active"); return;
    }
    setGesture("none"); setStatus("寻找手掌", "active"); return;
  }
  if (!cameraReady) unlockGames();
  const hand = result.landmarks[0], controlPoint = activeGame === "catch" ? hand[8] : hand[9];
  target.x = (1 - controlPoint.x) * width; target.y = controlPoint.y * height; setGesture(classify(hand));
  setStatus(activeGame === "catch" ? "食指已锁定" : "手掌已锁定", "active");
  handCtx.fillStyle = "#ffd263"; hand.forEach((p) => { handCtx.beginPath(); handCtx.arc(p.x * handCanvas.width, p.y * handCanvas.height, 4, 0, Math.PI * 2); handCtx.fill(); });
  if (activeGame === "catch") {
    const finger = hand[8];
    lastFingerPoint = { x: finger.x, y: finger.y }; fingerMissingFrames = 0; sampleFingerColor(finger); drawFingerMarker(finger);
  }
}

document.querySelectorAll(".game-tab").forEach((tab) => tab.addEventListener("click", () => showGame(tab.dataset.game)));
$("#cameraButton").addEventListener("click", enableCamera); $("#connectAndPlay").addEventListener("click", () => cameraReady ? startGame() : enableCamera());
$("#homeCameraCheck").addEventListener("click", enableCamera);
$("#backHome").addEventListener("click", showHome);
$("#homeNav").addEventListener("click", showHome); $("#gamesNav").addEventListener("click", showCatalog); $("#viewAllGames").addEventListener("click", showCatalog);
$("#restartButton").addEventListener("click", startGame);
function openCameraHelp() { $("#cameraHelp").classList.remove("hidden"); }
function closeCameraHelp() { $("#cameraHelp").classList.add("hidden"); }
$("#helpButton").addEventListener("click", openCameraHelp);
$("#closeHelp").addEventListener("click", closeCameraHelp);
$("#cameraHelp").addEventListener("click", (event) => { if (event.target.id === "cameraHelp") closeCameraHelp(); });
function achievementItems() {
  ensureStatsShape();
  const playedCount = Object.keys(appStats.played || {}).length;
  return [
    { title: "初次挥手", desc: "完成摄像头手势检测", done: cameraReady },
    { title: "游戏新手", desc: "完成任意一局游戏", done: appStats.games >= 1, progress: `${Math.min(appStats.games, 1)}/1` },
    { title: "六边形玩家", desc: "六款游戏都至少玩过一次", done: playedCount >= 6, progress: `${playedCount}/6` },
    { title: "连击达人", desc: "单局最高连击达到 15", done: (appStats.maxCombo || 0) >= 15, progress: `${Math.min(appStats.maxCombo || 0, 15)}/15` },
    { title: "阶段突破", desc: "任意游戏到达阶段 5", done: (appStats.bestStage || 1) >= 5, progress: `${Math.min(appStats.bestStage || 1, 5)}/5` },
    { title: "星光收藏家", desc: "累计获得 500 星光", done: appStats.stars >= 500, progress: `${Math.min(appStats.stars, 500)}/500` },
    { title: "得分达人", desc: "单局得分达到 100", done: appStats.highScore >= 100, progress: `${Math.min(appStats.highScore, 100)}/100` },
  ];
}
function openUtility(type) {
  const panel = $("#utilityPanel"), title = $("#utilityTitle"), eyebrow = $("#utilityEyebrow"), content = $("#utilityContent");
  panel.classList.remove("hidden");
  if (type === "profile") {
    eyebrow.textContent = "PLAYER PROFILE"; title.textContent = "Player One";
    content.innerHTML = `<div class="stats-grid"><div><span>已玩局数</span><strong>${appStats.games}</strong></div><div><span>最高得分</span><strong>${appStats.highScore}</strong></div><div><span>星光余额</span><strong>${appStats.stars}</strong></div></div>`;
  } else if (type === "achievements") {
    eyebrow.textContent = "ACHIEVEMENTS"; title.textContent = "我的成就";
    const items = achievementItems();
    content.innerHTML = `<div class="achievement-summary"><strong>${items.filter((item) => item.done).length}/${items.length}</strong><span>已解锁成果</span></div><div class="achievement-list">${items.map((item) => `<div class="achievement-row ${item.done ? "done" : ""}"><i>${item.done ? "✓" : "◇"}</i><div><b>${item.title}</b><small>${item.desc}</small></div><span>${item.done ? "已完成" : item.progress || "未完成"}</span></div>`).join("")}</div>`;
  } else {
    eyebrow.textContent = "SETTINGS"; title.textContent = "体验设置";
    content.innerHTML = `<div class="settings-list"><label class="setting-row"><span>高对比度界面</span><input id="contrastSetting" type="checkbox" ${document.body.classList.contains("high-contrast") ? "checked" : ""}></label><label class="setting-row"><span>镜像摄像头画面</span><input id="mirrorSetting" type="checkbox" ${document.body.classList.contains("no-mirror") ? "" : "checked"}></label></div>`;
    $("#contrastSetting").addEventListener("change", (event) => document.body.classList.toggle("high-contrast", event.target.checked));
    $("#mirrorSetting").addEventListener("change", (event) => document.body.classList.toggle("no-mirror", !event.target.checked));
  }
}
function closeUtility() { $("#utilityPanel").classList.add("hidden"); }
$("#profileButton").addEventListener("click", () => openUtility("profile")); $("#achievementsNav").addEventListener("click", () => openUtility("achievements")); $("#settingsNav").addEventListener("click", () => openUtility("settings"));
$("#closeUtility").addEventListener("click", closeUtility); $("#utilityCloseButton").addEventListener("click", closeUtility);
window.addEventListener("resize", resize); saveStats(); resize(); chooseGame("catch"); showHome(); requestAnimationFrame(loop);

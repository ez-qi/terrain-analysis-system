 // ============================================================
 // 降雨粒子系统与积水累积模拟模块
 // 创建日期: 2026-06-27 
 // 职责: 管理三维地形上的实时降雨粒子动画与水位动态累积
 // ============================================================
 
 window.window.rainSystemInstance = null;    // 全局降雨系统实例
 let rainTimer = null;             // 降雨计时器(秒)
 let rainAccumulation = 0;         // 累计降雨量(mm)
 window.window.rainPlaying = false;          // 播放状态
 let rainElapsedHours = 0;         // 经过的模拟小时数
 let lastRainTimestamp = 0;        // 上次更新时间戳
 const MAX_SIM_HOURS = 72;         // 最大模拟小时数

 // === 水文参数（水位动态累积） ===
 const RUNOFF_COEFF = 0.6;         // 有效降雨系数（多少降雨转化为积水，其余下渗）
 const LOSS_RATE = 0.5;            // 蒸发下渗率（mm/h，雨停或弱雨时水位下降）
 const MM_TO_METER = 0.15;         // mm 降雨 → 米水位的视觉化换算系数

 // 独立水位累加器（浮点，不经过滑条字符串量化，避免闪烁）
 let waterLevelAccum = 0;

 /**
  * 计算给定降雨量和时长下的预测淹没高度（米）
  * 公式：netAccum = rainRate × hours × RUNOFF_COEFF - LOSS_RATE × hours
  *       waterHeight = max(0, netAccum × MM_TO_METER)
  * @param {number} rainRate - 雨强 mm/h
  * @param {number} hours - 持续小时数
  * @returns {number} 淹没高度（米，未封顶）
  */
 function predictWaterHeight(rainRate, hours) {
     const accumulatedRain = rainRate * hours;                    // mm
     const netAccum = accumulatedRain * RUNOFF_COEFF - LOSS_RATE * hours;
     return Math.max(0, netAccum * MM_TO_METER);
 }
 
 // 降雨等级预设 (mm/h)
 const RAIN_PRESETS = {
     drizzle:    { name: '毛毛雨', rate: 2.5,  particles: 2000,  speed: 1.0 },
     light:      { name: '小雨',   rate: 8.0,  particles: 5000,  speed: 1.2 },
     moderate:   { name: '中雨',   rate: 20.0, particles: 10000, speed: 1.5 },
     heavy:      { name: '大雨',   rate: 40.0, particles: 15000, speed: 2.0 },
     storm:      { name: '暴雨',   rate: 80.0, particles: 20000, speed: 2.5 },
     torrential: { name: '大暴雨', rate: 150.0,particles: 25000, speed: 3.0 }
 };
 
 let currentRainPreset = null;  // 无默认预设，等用户点击选择
 let rainTimeSpeed = 60;  // 时间流速: 1秒模拟X分钟 (默认60=1小时/分钟)
 
 /**
  * 降雨粒子系统类
  * 使用 Three.js Points 实现降雨粒子效果
  */
 class RainSystem {
     constructor() {
         this.particles = null;
         this.geometry = null;
         this.material = null;
         this.count = 0;
         this.intensity = 0;
         this.terrainSize = 2400;
         this.maxHeight = 1500;
         this.active = false;
         this.positions = null;
         this.velocities = null;
     }
 
     /**
      * 初始化粒子系统
      * @param {THREE.Scene} scene - Three.js 场景
      * @param {number} terrainSize - 地形尺寸(米)
      * @param {number} maxHeight - 地形最大高度(米)
      */
     init(scene, terrainSize, maxHeight) {
         this.destroy();
         this.terrainSize = terrainSize || 2400;
         this.maxHeight = maxHeight || 1500;
         this.scene = scene;
         this.active = true;
 
         // 创建粒子纹理（细长雨滴形状）
         const canvas = document.createElement('canvas');
         canvas.width = 4;
         canvas.height = 32;
         const ctx = canvas.getContext('2d');
         ctx.clearRect(0, 0, 4, 32);
         const gradient = ctx.createLinearGradient(0, 0, 0, 32);
         gradient.addColorStop(0, 'rgba(180, 200, 255, 0)');
         gradient.addColorStop(0.2, 'rgba(180, 200, 255, 0.6)');
         gradient.addColorStop(0.5, 'rgba(200, 220, 255, 0.9)');
         gradient.addColorStop(0.8, 'rgba(200, 220, 255, 0.6)');
         gradient.addColorStop(1, 'rgba(180, 200, 255, 0)');
         ctx.fillStyle = gradient;
         ctx.fillRect(0, 0, 4, 32);
         const texture = new THREE.CanvasTexture(canvas);
 
         this.material = new THREE.PointsMaterial({
             map: texture,
             color: 0xaaccff,
             size: this.terrainSize / 120,
             transparent: true,
             opacity: 0.0,
             blending: THREE.AdditiveBlending,
             depthWrite: false,
             sizeAttenuation: true
         });
 
         return this;
     }
 
     /**
      * 设置降雨强度并重建粒子
      * @param {number} intensity - 强度值 0.0~1.0
      * @param {number} maxParticles - 最大粒子数
      */
     setIntensity(intensity, maxParticles) {
         if (!this.active) return;
         this.intensity = Math.max(0, Math.min(1, intensity));
 
         const baseCount = maxParticles || 25000;
         this.count = Math.floor(baseCount * this.intensity);
         if (this.count < 100) this.count = 0;
 
         // 重新创建几何体
         if (this.geometry) {
             this.geometry.dispose();
         }
 
         if (this.count === 0) {
             this.geometry = new THREE.BufferGeometry();
             this.geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
             if (this.particles) {
                 this.scene.remove(this.particles);
                 this.particles = null;
             }
             return;
         }
 
         this.geometry = new THREE.BufferGeometry();
         this.positions = new Float32Array(this.count * 3);
         this.velocities = new Float32Array(this.count);
 
         // 初始化粒子位置在雨区范围内
         const halfSize = this.terrainSize * 0.6;
         const heightRange = this.maxHeight * 1.5 + 200;
         for (let i = 0; i < this.count; i++) {
             this.positions[i * 3] = (Math.random() - 0.5) * halfSize * 2;
             this.positions[i * 3 + 1] = Math.random() * heightRange + 50;
             this.positions[i * 3 + 2] = (Math.random() - 0.5) * halfSize * 2;
             this.velocities[i] = 80 + Math.random() * 120;
         }
 
         this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
 
         if (this.particles) {
             this.scene.remove(this.particles);
         }
         this.particles = new THREE.Points(this.geometry, this.material);
         this.scene.add(this.particles);
     }
 
     /**
      * 每帧更新粒子位置
      * @param {number} deltaTime - 帧时间差(秒)
      * @param {number} speedMultiplier - 速度倍率
      */
     update(deltaTime, speedMultiplier) {
         if (!this.active || !this.particles || this.count === 0) return;
 
         const speed = (speedMultiplier || 1) * deltaTime;
         const halfSize = this.terrainSize * 0.6;
         const heightRange = this.maxHeight * 1.5 + 200;
         const windX = 15 * this.intensity;
         const windZ = 8 * this.intensity;
 
         const pos = this.geometry.attributes.position.array;
         for (let i = 0; i < this.count; i++) {
             pos[i * 3 + 1] -= this.velocities[i] * speed;
             pos[i * 3] += windX * speed;
             pos[i * 3 + 2] += windZ * speed;
 
             if (pos[i * 3 + 1] < -50 ||
                 Math.abs(pos[i * 3]) > halfSize ||
                 Math.abs(pos[i * 3 + 2]) > halfSize) {
                 pos[i * 3] = (Math.random() - 0.5) * halfSize * 2;
                 pos[i * 3 + 1] = Math.random() * heightRange + 50;
                 pos[i * 3 + 2] = (Math.random() - 0.5) * halfSize * 2;
             }
         }
         this.geometry.attributes.position.needsUpdate = true;
     }
 
     /**
      * 更新材质透明度
      */
     setOpacity(opacity) {
         if (this.material) {
             this.material.opacity = Math.max(0, Math.min(1, opacity));
         }
     }
 
     /**
      * 清理并销毁粒子系统
      */
     destroy() {
         if (this.particles) {
             if (this.scene) this.scene.remove(this.particles);
             this.particles = null;
         }
         if (this.geometry) {
             this.geometry.dispose();
             this.geometry = null;
         }
         if (this.material) {
             this.material.dispose();
             this.material = null;
         }
         this.active = false;
         this.count = 0;
     }
 }
 
 // ============================================================
 // 降雨模拟控制器（全局函数）
 // ============================================================
 
 /**
  * 初始化降雨系统
  */
 function initRainSystem() {
     rainTimer = 0;
     rainAccumulation = 0;
     rainElapsedHours = 0;
     window.rainPlaying = false;
     currentRainPreset = null;
     lastRainTimestamp = performance.now();
 
     window.rainSystemInstance = new RainSystem();
     scheduleRainUpdate();
 }
 
 /**
  * 启动/重建降雨粒子（地形重新生成后调用）
  */
 function setupRainParticles() {
     if (!window.rainSystemInstance) {
         window.rainSystemInstance = new RainSystem();
     }
 
     const terrainSize = parseFloat(document.getElementById('meshSize').value) || 2400;
     const maxHeight = window.lastMaxHeight || 1500;
     const exaggeration = parseFloat(document.getElementById('exaggeration').value) || 1.5;
 
     window.rainSystemInstance.init(window.scene3d, terrainSize, maxHeight * exaggeration + 200);

     // 无默认预设时使用 0 粒子数；用户点击预设后才设置强度
     const preset = currentRainPreset ? RAIN_PRESETS[currentRainPreset] : null;
     const precipVal = parseFloat(document.getElementById('precipitation').value) || 0;
     const intensity = Math.min(1, precipVal / 200);
     window.rainSystemInstance.setIntensity(intensity, preset ? preset.particles : 0);
     window.rainSystemInstance.setOpacity(window.rainPlaying ? 1.0 : 0.0);
 }
 
 /**
  * 调度降雨更新循环
  */
 function scheduleRainUpdate() {
     if (rainTimer !== null) {
         cancelAnimationFrame(rainTimer);
     }
 
     function tick() {
         if (window.rainPlaying && window.terrainMesh && window.rainSystemInstance) {
             const now = performance.now();
             const rawDelta = (now - lastRainTimestamp) / 1000;
             lastRainTimestamp = now;
             const deltaTime = Math.min(rawDelta, 0.1);
 
             const hoursPerStep = (rainTimeSpeed / 60) * deltaTime;
             const prevHours = rainElapsedHours;
             rainElapsedHours = Math.min(MAX_SIM_HOURS, rainElapsedHours + hoursPerStep);

             // 72h 硬终点：到达后冻结所有累积（时间、降水、水位）
             const reachedCap = rainElapsedHours >= MAX_SIM_HOURS;
             const effectiveStep = reachedCap ? 0 : (rainElapsedHours - prevHours);

             const precipSlider = document.getElementById('precipitation');
             const rainRate = parseFloat(precipSlider?.value || 0);
             const stepRain = rainRate * effectiveStep;
             rainAccumulation += stepRain;

             // === 水位累积计算（基于水文参数） ===
             // Δh = (stepRain × RUNOFF_COEFF - LOSS_RATE × effectiveStep) × MM_TO_METER
             // 72h 后 effectiveStep=0，水位冻结；雨强 < 损失率时水位下降（退水）
             const deltaHeight = (stepRain * RUNOFF_COEFF - LOSS_RATE * effectiveStep) * MM_TO_METER;

             const waterSlider = document.getElementById('waterHeight');
            const waterMax = parseFloat(waterSlider.max);
            // 独立浮点累加，避免滑条字符串量化导致整数边界闪烁
            waterLevelAccum = Math.min(waterMax, Math.max(0, waterLevelAccum + deltaHeight));
            waterSlider.value = waterLevelAccum;
            updateWaterPlane(waterLevelAccum);
             const currentWater = parseFloat(waterSlider.value) || 0;
             const newWater = Math.min(
                 parseFloat(waterSlider.max),
                 Math.max(0, currentWater + deltaHeight)
             );
             waterSlider.value = newWater;
             updateWaterPlane(newWater);
 
             // 更新粒子动画
             const speedMult = Math.max(0.1, (rainRate / 80) * 2);
             window.rainSystemInstance.update(deltaTime, speedMult);
 
             updateRainUI();
 
             if (window.terrainMesh && window.terrainMesh.material.uniforms) {
                 if (window.terrainMesh.material.uniforms.uPrecipitation) {
                     window.terrainMesh.material.uniforms.uPrecipitation.value = rainRate;
                 }
                 if (window.terrainMesh.material.uniforms.uTime) {
                     window.terrainMesh.material.uniforms.uTime.value += deltaTime * 2;
                 }
             }
         } else if (window.rainSystemInstance) {
             if (window.terrainMesh && window.terrainMesh.material.uniforms && window.terrainMesh.material.uniforms.uTime) {
                 window.terrainMesh.material.uniforms.uTime.value += 0.005;
             }
         }
         rainTimer = requestAnimationFrame(tick);
     }
     rainTimer = requestAnimationFrame(tick);
 }
 
 /**
  * 切换播放/暂停状态
  */
 function toggleRainPlay() {
     window.rainPlaying = !window.rainPlaying;
     lastRainTimestamp = performance.now();

     // 播放期间禁用时间滑条（仅非播放态可拖动调整预测值）
     const timeSlider = document.getElementById('rainTimeSlider');
     if (timeSlider) {
         timeSlider.disabled = window.rainPlaying;
         timeSlider.title = window.rainPlaying
             ? '播放期间不可手动调整，请暂停后再拖动'
             : '';
     }

     const btn = document.getElementById('rainPlayBtn');
     if (window.rainPlaying) {
         if (window.rainSystemInstance) {
             window.rainSystemInstance.setOpacity(1.0);
         }
         if (btn) { btn.innerHTML = '⏸ 暂停'; }
     } else {
         if (window.rainSystemInstance) {
             window.rainSystemInstance.setOpacity(0.0);
         }
         if (btn) { btn.innerHTML = '▶ 播放'; }
     }
 }
 
 /**
  * 应用降雨预设
  */
 function applyRainPreset(presetKey) {
     const preset = RAIN_PRESETS[presetKey];
     if (!preset) return;
 
     currentRainPreset = presetKey;
 
     const precipSlider = document.getElementById('precipitation');
     if (precipSlider) {
         precipSlider.value = preset.rate;
         document.getElementById('precipVal').innerText = preset.rate + ' mm';
         if (window.terrainMesh && window.terrainMesh.material.uniforms && window.terrainMesh.material.uniforms.uPrecipitation) {
             window.terrainMesh.material.uniforms.uPrecipitation.value = preset.rate;
         }
     }
 
     const intensity = Math.min(1, preset.rate / 200);
     if (window.rainSystemInstance) {
         window.rainSystemInstance.setIntensity(intensity, preset.particles);
     }
 
     document.querySelectorAll('.rain-preset-btn').forEach(btn => {
         btn.classList.remove('bg-blue-600', 'text-white', 'border-blue-500');
         btn.classList.add('bg-slate-700', 'text-slate-300', 'border-slate-600');
     });
     const activeBtn = document.querySelector(`.rain-preset-btn[data-preset="${presetKey}"]`);
     if (activeBtn) {
         activeBtn.classList.remove('bg-slate-700', 'text-slate-300', 'border-slate-600');
         activeBtn.classList.add('bg-blue-600', 'text-white', 'border-blue-500');
     }
 
     window.showBanner('已应用 "' + preset.name + '" 预设 (' + preset.rate + 'mm/h)', false);
 }
 
 /**
  * 设置时间流速
  */
 function setRainTimeSpeed(speed) {
     rainTimeSpeed = speed;
     document.querySelectorAll('.speed-btn').forEach(btn => {
         btn.classList.remove('bg-blue-600', 'text-white');
         btn.classList.add('bg-slate-700', 'text-slate-300');
     });
     const activeBtn = document.querySelector(`.speed-btn[data-speed="${speed}"]`);
     if (activeBtn) {
         activeBtn.classList.remove('bg-slate-700', 'text-slate-300');
         activeBtn.classList.add('bg-blue-600', 'text-white');
     }
 }
 
 /**
  * 重置降雨模拟
  */
 function resetRainSimulation() {
     rainAccumulation = 0;
     rainElapsedHours = 0;

     // 重置时恢复时间滑条为可拖状态
     const timeSlider = document.getElementById('rainTimeSlider');
     if (timeSlider) {
         timeSlider.disabled = false;
         timeSlider.title = '';
     }

     const waterSlider = document.getElementById('waterHeight');
     if (waterSlider) {
         waterLevelAccum = 0;
         waterSlider.value = 0;
         window.updateWaterPlane(0);
     }
 
     if (window.rainPlaying) {
         toggleRainPlay();
     }
 
     updateRainUI();
     window.showBanner('降雨模拟已重置', false);
 }
 
 /**
  * 更新降雨控制面板UI
  */
 function updateRainUI() {
     const timeEl = document.getElementById('rainTimeDisplay');
     const accumEl = document.getElementById('rainAccumDisplay');
     const rateEl = document.getElementById('rainRateDisplay');
 
     if (timeEl) {
         const hours = Math.floor(rainElapsedHours);
         const mins = Math.floor((rainElapsedHours - hours) * 60);
         timeEl.innerText = hours.toString().padStart(2, '0') + ':' + mins.toString().padStart(2, '0');
     }
     if (accumEl) {
         accumEl.innerText = rainAccumulation.toFixed(1);
     }
     if (rateEl) {
         const precipSlider = document.getElementById('precipitation');
         rateEl.innerText = parseFloat(precipSlider?.value || 0).toFixed(0);
     }
 
     const timeSlider = document.getElementById('rainTimeSlider');
     if (timeSlider) {
         timeSlider.value = rainElapsedHours;
     }
 }
 
 /**
  * 手动拖动时间滑块时的处理
  */
 function onRainTimeSliderChange(hours) {
     const h = parseFloat(hours) || 0;
     rainElapsedHours = Math.min(MAX_SIM_HOURS, Math.max(0, h));
 
     if (!window.rainPlaying) {
         const precipSlider = document.getElementById('precipitation');
         const rainRate = parseFloat(precipSlider?.value || 0);

         // 预测值：当前雨强持续到该时刻的累计降雨和淹没高度
         rainAccumulation = rainRate * rainElapsedHours;

         const waterSlider = document.getElementById('waterHeight');
         if (waterSlider) {
             const predictedHeight = predictWaterHeight(rainRate, rainElapsedHours);
             waterLevelAccum = Math.min(parseFloat(waterSlider.max), predictedHeight);
             waterSlider.value = waterLevelAccum;
             window.updateWaterPlane(waterLevelAccum);

             // 同步预测淹没高度显示
             const predictEl = document.getElementById('waterHeightPredictDisplay');
             if (predictEl) predictEl.innerText = waterLevelAccum.toFixed(1);
             const newWater = Math.min(parseFloat(waterSlider.max), predictedHeight);
             waterSlider.value = newWater;
             window.updateWaterPlane(newWater);

             // 同步预测淹没高度显示
             const predictEl = document.getElementById('waterHeightPredictDisplay');
             if (predictEl) predictEl.innerText = newWater.toFixed(1);
         }
         updateRainUI();
     }
 }
 
 /**
  * 清理降雨系统（地形重建时调用）
  */
 function cleanupRainSystem() {
     if (window.rainSystemInstance) {
         window.rainSystemInstance.destroy();
     }
 }

// ESM 导出
window.initRainSystem = initRainSystem;
window.setupRainParticles = setupRainParticles;
window.applyRainPreset = applyRainPreset;
window.setRainTimeSpeed = setRainTimeSpeed;
window.toggleRainPlay = toggleRainPlay;
window.resetRainSimulation = resetRainSimulation;
window.onRainTimeSliderChange = onRainTimeSliderChange;

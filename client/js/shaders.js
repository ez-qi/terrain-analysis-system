// GPU 渲染管线自定义着色器资源 (GLSL)

const terrainVertexShader = `
varying vec3 vPosition;
varying vec3 vNormal;
varying vec2 vUv;
void main() {
    vPosition = position;
    vNormal = normal;
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;



const terrainFragmentShader = `
varying vec3 vPosition;
varying vec3 vNormal;
varying vec2 vUv;

uniform float uShowContours;
uniform float uContourSpacing;
uniform vec3 uContourColor;
uniform float uContourLineWidth; 
uniform float uTextureMode; 
uniform sampler2D uSatelliteTex;
uniform vec3 uSunDirection;      

uniform float uWaterHeight; 
uniform float uTime;        

// 【新增】灾害推演 Uniforms
uniform float uPrecipitation; // 降水量 (mm)
uniform float uBaseVeg;       // AI评估的基准植被覆盖率 (0.0~1.0)

// 【扩展】多因子权重 + 临界阈值 + 累计降水演化
uniform float uSoilWeight;
uniform float uLithologyWeight;
uniform float uVegWeight;
uniform float uSlopeWeight;
uniform float uVegRootDepth;
uniform float uHistDensity;
uniform float uFaultProx;
uniform float uCriticalPrecip;
uniform float uRiskDelay;
uniform float uRiskDecay;
uniform float uSoilFactor;
uniform float uLithologyFactor;
uniform float uRainAccum;
uniform float uTimeSinceRain;
uniform float uSoilPermeability;   // 土壤渗透率（mm/h）
uniform float uMaxAbsorption;      // 地形最大蓄水量（mm）

void main() {
    vec3 baseColor;
    vec3 norm = normalize(vNormal);
    
    // 1. 提取坡度 (0.0=平地, 1.0=90度垂直峭壁)
    float slope = 1.0 - max(0.0, dot(norm, vec3(0.0, 1.0, 0.0))); 

    if (uTextureMode > 1.5) {
        // ==========================================
        // 🚨 模式3：滑坡/泥石流灾害风险热力图（WLC 加权线性叠加）
        // 业内基础法：各因子归一化 0~1，按权重加权求和，无乘积饱和
        // ==========================================

        // A. 各地形因子归一化（0~1）
        float slopeFactor = smoothstep(0.15, 0.65, slope);
        float vegFactor = clamp(uBaseVeg * smoothstep(0.0, 2.0, uVegRootDepth), 0.0, 1.0);
        float soilFactor = clamp(uSoilFactor, 0.0, 1.0);
        float lithFactor = clamp(uLithologyFactor * (1.0 + uFaultProx), 0.0, 1.0);

        // B. 土壤渗透与水量平衡
        // 渗透量 = 渗透率 × 时间 × (1 − 植被截留系数)，被最大蓄水量封顶
        float absorbed = uSoilPermeability * uTimeSinceRain * (1.0 - uBaseVeg * 0.3);
        absorbed = min(absorbed, uMaxAbsorption);
        // 有效降水 = 累计降雨 − 已渗透吸收量
        float effectivePrecip = max(0.0, uRainAccum - absorbed);
        // 净水量风险 = 有效降水 / 临界阈值（超过吸收能力才升风险）
        float precipFactor = clamp(effectivePrecip / max(1.0, uCriticalPrecip), 0.0, 1.0);

        // 雨停滞后回落：timeSinceRain > riskDelay 后按 riskDecay 加速退水
        float decayReduction = 0.0;
        if (uTimeSinceRain > uRiskDelay) {
            decayReduction = (uTimeSinceRain - uRiskDelay) * uRiskDecay;
        }
        precipFactor *= max(0.0, 1.0 - decayReduction);

        // 历史密度加成（复发地带加成，最高 +50%）
        float histBoost = 1.0 + uHistDensity * 0.5;

        // C. WLC 加权线性叠加
        // 静态因子权重压缩（和 ≈ 0.45），让初始为绿；降水占主导 0.55
        // 降水贡献乘坡度门槛：平原无坡不升风险（降水再多也只是积水不滑坡）
        float slopeGate = smoothstep(0.05, 0.3, slope);
        float risk = 0.0;
        risk += 0.15 * slopeFactor;           // 坡度贡献
        risk += 0.10 * (1.0 - vegFactor);     // 植被缺失贡献
        risk += 0.10 * soilFactor;            // 土壤贡献
        risk += 0.10 * lithFactor;            // 岩层贡献
        risk += 0.55 * precipFactor * slopeGate;  // 降水贡献（平原无坡不升风险）
        risk *= histBoost;
        risk = clamp(risk, 0.0, 1.0);

        // D. 热力图设色 (绿 -> 黄 -> 橙 -> 红)
        vec3 safeColor = vec3(0.1, 0.7, 0.2);
        vec3 warnColor = vec3(0.9, 0.8, 0.1);
        vec3 dangerColor = vec3(0.9, 0.1, 0.1);
        vec3 riskColor = mix(safeColor, warnColor, smoothstep(0.0, 0.5, risk));
        riskColor = mix(riskColor, dangerColor, smoothstep(0.5, 1.0, risk));

        float gray = dot(vec3(0.38, 0.31, 0.21), vec3(0.333));
        baseColor = mix(vec3(gray), riskColor, 0.85);

    } else if (uTextureMode > 0.5) {
        baseColor = texture2D(uSatelliteTex, vUv).rgb;
    } else {
        vec3 dirtColor = vec3(0.38, 0.31, 0.21);
        vec3 grassColor = vec3(0.19, 0.45, 0.16);
        vec3 rockColor = vec3(0.36, 0.38, 0.40);
        vec3 snowColor = vec3(0.95, 0.95, 0.98);

        baseColor = mix(dirtColor, grassColor, 1.0 - slope);
        float rockBlend = smoothstep(0.25, 0.50, slope);
        baseColor = mix(baseColor, rockColor, rockBlend);

        float heightFactor = clamp(vPosition.y / 2500.0, 0.0, 1.0);
        float snowBlend = smoothstep(0.70, 0.90, heightFactor) * (1.0 - smoothstep(0.2, 0.4, slope));
        baseColor = mix(baseColor, snowColor, snowBlend);
    }

    // GPU 等高线计算
    if (uShowContours > 0.5) {
        float f = vPosition.y / uContourSpacing;
        float df = fwidth(f);
        float distanceToLine = abs(fract(f + 0.5) - 0.5);
        
        float lineAlpha = smoothstep(df * uContourLineWidth, df * (uContourLineWidth * 0.15), distanceToLine);
        
        float majorF = vPosition.y / (uContourSpacing * 5.0);
        float majorDf = fwidth(majorF);
        float majorDistance = abs(fract(majorF + 0.5) - 0.5);
        float majorLineAlpha = smoothstep(majorDf * (uContourLineWidth * 1.8), majorDf * 0.4, majorDistance);
        
        float finalLineAlpha = max(lineAlpha * 0.6, majorLineAlpha * 0.95);
        baseColor = mix(baseColor, uContourColor, finalLineAlpha);
    }

    // 贴地自适应积水仿真渲染
    float waterDepth = uWaterHeight - vPosition.y;
    if (waterDepth > 0.0) {
        float depthFactor = clamp(waterDepth / 120.0, 0.0, 1.0);
        vec3 shallowWaterColor = vec3(0.0, 0.45, 0.62);
        vec3 deepWaterColor = vec3(0.01, 0.12, 0.32);
        vec3 waterColor = mix(shallowWaterColor, deepWaterColor, depthFactor);

        float wave = sin(vPosition.x * 0.12 + uTime * 2.5) * cos(vPosition.z * 0.12 + uTime * 2.1) * 0.05;
        wave += sin(vPosition.x * 0.35 - uTime * 3.5) * cos(vPosition.z * 0.35 + uTime * 2.8) * 0.02;

        vec3 viewDir = normalize(vec3(0.0, 1.0, 0.0));
        vec3 halfDir = normalize(uSunDirection + viewDir);
        float spec = pow(max(dot(norm, halfDir), 0.0), 64.0) * 0.65;

        float waterOpacity = smoothstep(0.0, 15.0, waterDepth) * 0.82 + 0.12;
        waterOpacity = clamp(waterOpacity + wave * 0.1, 0.0, 1.0);

        baseColor = mix(baseColor, waterColor + vec3(wave) + vec3(spec), waterOpacity);
    }

    float diff = max(dot(norm, uSunDirection), 0.0);
    float ambient = 0.45;

    vec3 finalColor = baseColor * (diff + ambient);
    gl_FragColor = vec4(finalColor, 1.0);
}
`;

const sideVertexShader = `
varying vec3 vPosition;
void main() {
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const sideFragmentShader = `
varying vec3 vPosition;
void main() {
    float h = vPosition.y;
    float layer = sin(h * 0.04) * 0.4 + sin(h * 0.12) * 0.2 + sin(h * 0.35) * 0.1;
    
    vec3 darkEarth = vec3(0.25, 0.18, 0.12);
    vec3 clayOchre = vec3(0.38, 0.28, 0.18);
    vec3 slateGray = vec3(0.20, 0.21, 0.23);
    
    vec3 finalColor = darkEarth;
    if (layer < -0.15) {
        finalColor = mix(darkEarth, slateGray, smoothstep(-0.4, -0.15, layer));
    } else {
        finalColor = mix(darkEarth, clayOchre, smoothstep(-0.15, 0.3, layer));
    }
    
    gl_FragColor = vec4(finalColor * 0.85, 1.0);
}
`;

// ESM 导出 — 供 main.js 的 generate3DTerrain 使用
window.terrainVertexShader = terrainVertexShader;
window.terrainFragmentShader = terrainFragmentShader;
window.sideVertexShader = sideVertexShader;
window.sideFragmentShader = sideFragmentShader;

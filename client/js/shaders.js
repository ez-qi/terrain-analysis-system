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

void main() {
    vec3 baseColor;
    vec3 norm = normalize(vNormal);
    
    // 1. 提取坡度 (0.0=平地, 1.0=90度垂直峭壁)
    float slope = 1.0 - max(0.0, dot(norm, vec3(0.0, 1.0, 0.0))); 

    if (uTextureMode > 1.5) {
        // ==========================================
        // 🚨 模式3：滑坡/泥石流灾害风险热力图
        // ==========================================
        
        // A. 提取山体坡向 (Aspect): 假定 Z>0为南(向阳), Z<0为北(向阴)
        float aspect = dot(normalize(vec3(norm.x, 0.0, norm.z)), vec3(0.0, 0.0, 1.0));
        
        // B. 植被覆盖动态修正模型
        // 坡度越陡峭 (slope > 0.4)，植被越难以附着，覆盖率断崖式下跌
        float slopePenalty = smoothstep(0.3, 0.7, slope);
        float localVeg = uBaseVeg * (1.0 - slopePenalty * 0.8);
        
        // 向阴面(北坡)土壤水分挥发少，植被通常好于向阳面
        localVeg += (aspect < 0.0 ? 0.08 : -0.05); 
        localVeg = clamp(localVeg, 0.0, 1.0);
        
        // C. 灾害风险动力学公式 (Heuristic Model)
        // 风险正比于坡度骤变因子、降水因子，反比于局部植被固土能力
        float precipFactor = clamp(uPrecipitation / 800.0, 0.0, 1.0);
        float slopeRisk = smoothstep(0.15, 0.65, slope); // 危险坡度区间
        
        // 综合灾害指数 (0.0 ~ 1.0)
        float risk = slopeRisk * precipFactor * (1.2 - localVeg);
        risk = clamp(risk, 0.0, 1.0);
        
        // D. 热力图设色 (绿 -> 黄 -> 橙 -> 红)
        vec3 safeColor = vec3(0.1, 0.7, 0.2);   // 安全区 (低风险)
        vec3 warnColor = vec3(0.9, 0.8, 0.1);   // 警告区 (黄)
        vec3 dangerColor = vec3(0.9, 0.1, 0.1); // 极危区 (红)
        
        vec3 riskColor = mix(safeColor, warnColor, smoothstep(0.0, 0.5, risk));
        riskColor = mix(riskColor, dangerColor, smoothstep(0.5, 1.0, risk));
        
        // 与地形灰度叠加保留立体凹凸阴影感
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

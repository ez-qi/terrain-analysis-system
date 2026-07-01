此目录存放预下载的 GeoTIFF 高程数据文件。

数据来源：地理空间数据云 (https://www.gscloud.cn) ASTER GDEM V3 30m

命名规则：<地名>.tif（如 huangshan.tif）

下载方式：登录地理空间数据云 → DEM 数字高程数据 → ASTER GDEM 30M
→ 框选区域 → 下载 GeoTIFF → 放入此目录

预设区域文件列表（可选下载）：
- taibei.tif      (36.25, 117.10)
- huangshan.tif   (30.13, 118.18)
- huashan.tif     (34.48, 110.08)
- longhushan.tif  (28.18, 117.02)

系统会自动查找匹配的 GeoTIFF 文件。未找到时自动回退到免费 Open-Meteo 高程 API。

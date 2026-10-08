# Doro 骑自行车

`doro_cycling.mp4`：毛绒 Doro 侧身骑自行车的 5 秒写实风格动画（1280×720，30fps，H.264）。

- 毛绒质感：程序生成的毛绒纹理、柔和体积光影、刺绣眼睛和缝线
- 场景：公园小路、浅景深虚化的树林和光斑、草地、樱花花瓣、投影
- 镜头：跟拍，背景有视差和运动模糊

重新生成（需要 Python 3、NumPy、SciPy、Pillow 和 ffmpeg）：

```bash
pip install numpy scipy pillow
python3 render_doro_cycling.py doro_cycling.mp4
```

# Image2 手机访问部署说明

这个项目已经整理成可部署到 Render 的 Node 网站。部署后手机不需要打开电脑，直接访问 Render 给你的公网网址即可。

## 推荐：Render 部署

1. 把 `D:\agent\add` 这个文件夹上传到 GitHub 仓库。
2. 打开 Render，选择 New Web Service。
3. 连接这个 GitHub 仓库。
4. Render 会读取 `render.yaml`，自动使用：
   - Build Command: `npm install`
   - Start Command: `npm start`
5. 在 Render 的 Environment Variables 里设置：
   - `IMAGE_API_KEY`: 你的 API key
   - `APP_PASSWORD`: `sam`
   - `IMAGE_API_BASE_URL`: `https://llmhub.ltd/v1`
   - `IMAGE_MODEL`: `gpt-image-2`
   - `SESSION_SECRET`: 任意长随机字符串
6. 部署完成后，用手机打开 Render 提供的网址。

## 注意

- 不要上传 `.env`，里面有真实 API key；`.gitignore` 已经排除它。
- 手机访问的是部署后的公网网址，不是 `localhost`。
- 图库保存在手机浏览器本地；换手机或清浏览器数据后图库不会同步。

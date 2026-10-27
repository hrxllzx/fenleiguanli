# 作业分类与任务分发系统

一个「学生上传 → AI 自动分类 → 按类别下发任务」的轻量教学/办公系统，含**学生界面**和**老师后台**，可直接部署到 GitHub。

## 功能

**学生界面**
- 上传文件（支持多选、拖拽）
- 查看自己上传的文件及其分类结果
- 接收按分类下发的任务，查看任务说明/附件，标记完成

**老师后台**
- 概览仪表盘（学生数、文件数、已分类数、任务数）
- 文件管理：查看所有学生上传，手动改分类，删除文件
- 分类规则：自定义类别 + 给每类写「分类规则」（交给 AI 判断的依据）
- 任务管理：上传任务（可绑附件），每类绑定一个指定任务
- 一键 AI 自动分类：按规则把未分类文件归类，并自动下发对应任务
- 用户管理：把任意用户设为学生/老师

## 架构

```
浏览器（学生/老师两个界面）
        │  REST / Storage / Auth
        ▼
   GitHub Pages（纯静态前端）
        │
        ▼
   Supabase（免费云后端：账号 + Postgres + 文件存储）
        │  调用
        ▼
   DeepSeek AI（按「分类规则」自动归类文件）
```

- 前端是纯 HTML/CSS/JS，无构建、无第三方 CDN 依赖（对国内网络友好），直接放到 GitHub Pages 即可。
- 后端用 [Supabase](https://supabase.com) 免费版，多用户、云端存储、行级安全全包。
- AI 用 [DeepSeek](https://platform.deepseek.com)（也可以换成任何兼容 OpenAI 接口的模型）。

## 目录结构

```
fenleixitong/
├── index.html                 # 入口页面
├── css/style.css              # 样式
├── js/
│   ├── config.js              # ★ 配置（Supabase 地址/密钥）
│   ├── backend.js             # 后端适配层（Supabase + 本地演示）
│   └── app.js                 # 界面逻辑
├── supabase/
│   ├── schema.sql             # ★ 建表 + 行级安全（部署时执行）
│   └── functions/classify/index.ts   # ★ AI 分类函数（部署到 Supabase）
└── README.md
```

## 一、本地快速体验（演示模式）

`js/config.js` 里 `SUPABASE_URL` 留空即可进入演示模式：**直接双击打开 `index.html`** 就能体验完整界面。

- 注册时「老师注册码」填 `teacher123` 即可注册成老师，看老师后台。
- 演示模式下数据只存在本浏览器（localStorage），AI 分类用关键词规则模拟。
- 体验流程：注册学生 → 上传几个文件 → 退出 → 注册老师 → 加分类规则 → 加任务 → 点「自动分类」→ 学生登录看任务。

## 二、线上部署（真实多用户 + 云端 + AI）

### 第 1 步：创建 Supabase 项目

1. 打开 <https://supabase.com>，用 GitHub 账号登录，点 **New project**（选离你近的区域）。
2. 记住项目密码，等它初始化完（约 1 分钟）。
3. 进入 **Project Settings → API**，复制两个值备用：
   - `Project URL`（形如 `https://xxxx.supabase.co`）
   - `anon public`（公开密钥，可以放心放进前端）

### 第 2 步：建表（执行 SQL）

1. 左侧菜单 **SQL Editor → New query**。
2. 把本仓库 `supabase/schema.sql` 的**全部内容**粘贴进去，点 **Run**。

### 第 3 步：部署 AI 分类函数

**方式 A（推荐，无需装任何东西）：用面板**

1. 左侧菜单 **Edge Functions → New function**，名称填 `classify`。
2. 把 `supabase/functions/classify/index.ts` 的内容粘贴进去，点 **Deploy**。
3. 在函数设置里添加 **Secrets**（环境变量）：
   - `DEEPSEEK_API_KEY` = 你的 DeepSeek API Key（在 <https://platform.deepseek.com> 申请）
   - `DEEPSEEK_MODEL`（可选，默认 `deepseek-chat`）
   - `DEEPSEEK_BASE_URL`（可选，默认 `https://api.deepseek.com`；若用其它兼容端点则填）

**方式 B：用 CLI**

```bash
npm i -g supabase
supabase login
supabase functions deploy classify --project-ref <你的项目ref>
supabase secrets set DEEPSEEK_API_KEY=你的key
```

### 第 4 步：填前端配置

编辑 `js/config.js`：

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://xxxx.supabase.co",   // 第 1 步复制的 Project URL
  SUPABASE_ANON_KEY: "eyJhbGci...",           // 第 1 步复制的 anon public
  ...
};
```

### 第 5 步：把你自己设为「老师」

在 **SQL Editor** 执行（把 `老师账号` 换成你自己的注册账号）：

```sql
update public.profiles set role = 'teacher' where username = '老师账号';
```

> 之后可以在老师后台的「用户管理」里把其他用户设为老师。

### 第 6 步：发布到 GitHub Pages

1. 在 GitHub 新建仓库，把本目录推上去。
2. **Settings → Pages → Source 选 `main` 分支根目录 → Save**。
3. 等 1~2 分钟，访问 `https://<你的用户名>.github.io/<仓库名>/` 即可。

> 建议：Supabase 后台 **Authentication → Providers → Email** 里关掉 **Confirm email**，注册后直接登录，省去邮箱确认。

## 三、使用流程

1. 老师先在后台加好「分类规则」（例如：论文 / 实验报告 / 作业，每类写清楚 AI 怎么判断）。
2. 老师加好「任务」，每个任务绑定一个分类（不绑定则为默认任务）。
3. 学生注册登录 → 上传文件。
4. 老师在「概览」点 **开始自动分类** → AI 按规则归类 → 自动把每类的任务下发给对应学生。
5. 老师也可在「文件管理」里手动改某个文件的分类（会同样自动下发任务）。
6. 学生登录看到自己的任务 → 完成 → 标记完成。

## 常见问题

- **AI 分类不准确？** 到「分类规则」把每类的规则写得更具体（文件名关键词、内容特征等），分类函数会把文件名和文本内容一起交给 AI。
- **图片/PDF 分类？** DeepSeek 是文本模型，图片/PDF 目前按「文件名 + 文本类内容」判断。若要按图像内容分类，需换视觉模型（可改 `classify/index.ts`）。
- **不想用 Supabase？** 后端适配层在 `js/backend.js` 里是接口化的，可换 Firebase / 自建后端，前端界面不用改。

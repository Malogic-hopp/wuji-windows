# Bridge sidecar layouts

本目录只接收由 `pnpm bridge:prepare` 生成的本地开发输出：

```text
sidecars/bridge/QuantifiedSelf.Windows.Client.Bridge.exe
```

输出目录已被 Git 忽略。Rust Shell 只使用这个固定位置，并固定传入 `--channel dev`；React 无法提供可执行文件、路径或 channel。

阶段 7A 的 Release dev-preview 包不从本目录直接运行。它由仓库根目录的
`publish/scripts/publish-tauri.ps1` 按 `publish/tauri/package-layout.v1.json`
组装，并使用 Cargo target triple 命名 Bridge apphost：

```text
app/
  quantified-self-windows-tauri.exe
  bridge/
    QuantifiedSelf.Windows.Client.Bridge-x86_64-pc-windows-msvc.exe
    Agent/
      QuantifiedSelf.Windows.Agent.exe
```

Bridge 与 Agent 都是 self-contained，并保留在各自目录中。不得把它们的依赖
平铺到 Tauri app 根目录，也不得由 React 传入 sidecar 路径、target triple 或 channel。

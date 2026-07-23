# 番茄钟桌面应用

安装脚本会创建专用 Conda 环境 `pomodoro-app`，安装 `desktop/requirements.txt` 中的依赖，创建运行数据目录，并在当前用户桌面生成 `番茄钟.lnk`。重复运行同一命令会复用环境、更新依赖并重新生成快捷方式。

## 单命令安装

前提：项目位于 `D:\Project\pomodoro-paper-workbench`，且 Conda 默认安装在 `D:\DevTools\Anaconda3`。打开 PowerShell，执行：

```powershell
& 'D:\Project\pomodoro-paper-workbench\desktop\install.ps1'
```

如 PowerShell 阻止本地脚本，可仅对本次进程放宽策略后安装：

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
& 'D:\Project\pomodoro-paper-workbench\desktop\install.ps1'
```

如果 Conda 位于其他位置，可显式传入可执行文件：

```powershell
$CondaExe = 'D:\其他位置\Anaconda3\Scripts\conda.exe'
& 'D:\Project\pomodoro-paper-workbench\desktop\install.ps1' -CondaExe $CondaExe
```

安装完成后应存在：

- Conda 环境：名称为 `pomodoro-app`；实际位置由该 Conda 的 `envs_dirs` 配置决定
- 数据目录：`D:\DevTools\PomodoroLauncher\data`
- 日志目录：`D:\DevTools\PomodoroLauncher\logs`
- 桌面快捷方式：`%USERPROFILE%\Desktop\番茄钟.lnk`

不要用 `<Conda 根目录>\envs\pomodoro-app` 推测环境位置。使用安装时同一个 `conda.exe` 查询实际 prefix，并验证 `pythonw.exe`：

```powershell
$CondaExe = Read-Host '请输入安装时使用的 conda.exe 完整路径'
$DesktopRoot = 'D:\Project\pomodoro-paper-workbench\desktop'
. (Join-Path $DesktopRoot 'install-utils.ps1')
$PrefixProbe = Join-Path $DesktopRoot 'print-env-prefix.py'
$prefixOutput = @(& $CondaExe run -n pomodoro-app python $PrefixProbe)
if ($LASTEXITCODE -ne 0 -or $prefixOutput.Count -eq 0) { throw '无法查询 pomodoro-app 的实际位置。' }
$environmentPath = Get-CondaPrefixFromOutput -OutputLines $prefixOutput
$environmentPath
Test-Path -LiteralPath (Join-Path $environmentPath 'pythonw.exe')
```

## 启动与退出

双击桌面的“番茄钟”即可通过专用环境的 `pythonw.exe` 启动应用，不会打开控制台窗口。正常关闭应用窗口即可退出。

启动失败时，先查看 `D:\DevTools\PomodoroLauncher\logs\desktop.log`。

## 迁移项目

快捷方式会记录安装时的项目位置。移动或重新克隆仓库后，请从新仓库再次运行 `desktop\install.ps1`，以更新快捷方式的入口和工作目录；已有的 `pomodoro-app` 环境会被复用，数据和日志仍保存在 `D:\DevTools\PomodoroLauncher`。

如果迁移到的机器上 Conda 路径不同，请同时使用 `-CondaExe` 参数，并在后续验证或卸载时继续使用该路径。应用当前固定使用 `D:\DevTools\PomodoroLauncher\data` 和 `D:\DevTools\PomodoroLauncher\logs`，迁移前请按需备份数据目录。

## Edge 数据迁移到桌面版

从最终的 D 盘克隆 `D:\to do` 迁移现有 Edge 数据时，请严格按以下顺序操作：

1. 在 PowerShell 中运行 `& 'D:\to do\serve.cmd'`，确认终端显示本地地址，然后用 Edge 打开 `http://localhost:4173`。
2. 在 Edge 页面逐项确认原有活动清单、今日待办、紧急事项、番茄/打断记录、每日总结和设置仍然可见。
3. 点击“导出数据”，把生成的 JSON 文件保留在 `D:\to do` 以外的可靠位置；迁移完成后也继续保留这份 JSON 备份。
4. 回到运行服务器的终端按 `Ctrl+C`，确认 `http://localhost:4173` 已停止，再关闭对应的 Edge 页面。
5. 双击桌面的“番茄钟”快捷方式启动桌面版，点击“导入数据”并选择刚才保留的 JSON 文件。
6. 导入后对照 Edge 中确认过的内容，逐项比较桌面版可见的活动、待办、记录、总结和设置。
7. 关闭桌面版窗口，再次从快捷方式打开，确认导入的数据仍然存在，以验证持久化。
8. 在 JSON 备份已保留、导入成功、关闭重开后的持久化已验证，并且用户明确确认迁移结果之前，**不要删除或移走 `D:\to do`**。

## 故障排查

- 提示找不到 Conda：确认 `conda.exe` 的实际路径，再通过 `-CondaExe` 传入；验证和卸载也要使用同一个路径。
- 依赖安装失败：检查网络和 Conda 环境是否可写，然后重新运行安装命令。
- 双击快捷方式无响应：查看 `D:\DevTools\PomodoroLauncher\logs\desktop.log`，并确认仓库仍位于安装时的位置；仓库移动后需重跑安装脚本。
- 快捷方式未出现：确认 `[Environment]::GetFolderPath('Desktop')` 返回的目录，然后重跑安装脚本。
- 需要完全重建环境：先按下方命令移除环境，再重新安装。

## 卸载

在 PowerShell 中执行：

```powershell
$CondaExe = Read-Host '请输入安装时使用的 conda.exe 完整路径'
Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Desktop')) '番茄钟.lnk') -Force -ErrorAction SilentlyContinue
& $CondaExe env remove -n pomodoro-app -y
if ($LASTEXITCODE -ne 0) { throw 'Conda 环境卸载失败。' }
```

上述命令不会删除用户数据。如确认不再需要数据和日志，可另行执行：

```powershell
Remove-Item -LiteralPath 'D:\DevTools\PomodoroLauncher' -Recurse -Force
```

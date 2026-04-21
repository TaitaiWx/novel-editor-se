; ─────────────────────────────────────────────────────────────────────────
; 自定义 NSIS 脚本 — 由 electron-builder 在打包时合并到默认安装脚本中
; 目标：升级前自动关闭旧版本，避免出现“无法关闭，请手动关闭它”的弹窗
; 文档：https://www.electron.build/configuration/nsis
; ─────────────────────────────────────────────────────────────────────────

; 静默尝试结束旧进程；忽略错误（进程不存在时返回非 0 也无所谓）
!macro killRunningInstances
  DetailPrint "尝试关闭已运行的 ${PRODUCT_FILENAME}..."
  ; /F 强制结束 / /T 同时结束子进程；SetDetailsPrint none 防止进度噪音
  nsExec::Exec 'taskkill /F /T /IM "${PRODUCT_FILENAME}.exe"'
  Pop $0
  ; 留出短暂时间让句柄释放，避免随后覆盖文件失败
  Sleep 1500
!macroend

; 安装阶段：进入安装前先尝试关闭旧实例
!macro customInit
  !insertmacro killRunningInstances
!macroend

; 升级覆盖阶段（electron-builder NSIS 用到）：双保险
!macro customInstall
  !insertmacro killRunningInstances
!macroend

; 卸载阶段：避免文件占用导致回退安装失败
!macro customUnInit
  !insertmacro killRunningInstances
!macroend

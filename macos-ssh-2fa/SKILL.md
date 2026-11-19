---
name: macos-ssh-2fa
description: Use when securing macOS SSH or lock-screen login fails.
---

# macOS SSH 双因素 + 锁屏登录排障

## 先判断能力边界，别乱承诺
- 系统登录窗/锁屏**不能**加 TOTP：只有 password / smart card / Apple Watch / Touch ID。第三方 PAM 只作用于 sshd、sudo、screensaver 等 PAM 链。
- **Mac mini 无内置指纹硬件**（Mac16,10 等）。`bioutil -r` 显示 unlock=1 只是标志位；`bioutil -c` 恒为 0 表示「没有硬件」，不是「没录指纹」——别建议补录，只有 Magic Keyboard with Touch ID（Apple Silicon）或 Apple Watch 自动解锁可行。

## SSH 加 TOTP（密码 + 动态码，串联）
1. `brew install google-authenticator-libpam`
2. 用户侧生成：`google-authenticator -t -d -f -r 3 -R 30 -w 3` → `~/.google_authenticator`（600）。打印的恢复码必须让用户存好。
3. `/etc/pam.d/sshd` 的 auth 段追加 **required**：
   `auth required /opt/homebrew/opt/google-authenticator-libpam/lib/security/pam_google_authenticator.so`
   - `required` 才是真双因素（密码 AND OTP）；写成 `sufficient` 会变成「二选一」。
   - `nullok` = 未配 OTP 的账号可跳过第二因素，全员都有密钥后必须去掉。
4. `/etc/ssh/sshd_config.d/200-2fa.conf`：
   ```
   PasswordAuthentication no
   KbdInteractiveAuthentication yes
   AuthenticationMethods keyboard-interactive
   ```
   macOS 上 TOTP 走 PAM，所以必须开 keyboard-interactive、关裸 password。副作用：非交互/BatchMode 的 ssh 会直接失败。
5. `sshd -t` 校验后 `launchctl kickstart -k system/com.openssh.sshd`；sshd 由 launchd 按连接拉起，重载不断已有会话。

## 验证（靠证据，不靠猜）
用 pty 脚本模拟客户端看提示序列，出现 `Password:` → `Verification code:` → `Permission denied`（喂错密码 + 正确验证码仍被拒）即证明两关串联。
- 日志 `AppleMobileFileIntegrity: Library Validation failed ... pam_google_authenticator.so` 是**杂音**：平台签名进程首次 dlopen 第三方 .so 会报，PAM 链路照常工作，别据此判失败。
- 回滚：改前 `cp -p /etc/pam.d/sshd /etc/pam.d/sshd.bak-$(date +%Y%m%d-%H%M%S)`；回滚时恢复备份 + `rm -f 200-2fa.conf` + kickstart。

## 锁屏「密码突然不对」→ 先怀疑输入法
证据链：`log show` 里 `opendirectoryd: Failed SecureToken authentication ... invalid credentials`，配合 `dscl . -read /Users/$U accountPolicyData` 看 `failedLoginCount` / `passwordLastSetTime`。
根因常在 `/Library/Preferences/com.apple.HIToolbox.plist`（控制锁屏/登录窗，**与用户级 ~/Library 那套完全独立**）：
- `AppleCurrentKeyboardLayoutInputSourceID = com.apple.keylayout.PinyinKeyboard` 或 `AppleSelectedInputSources` 指向 SCIM → 锁屏敲字母出候选汉字，密码必然校验失败。
- 锁屏时 Ctrl+Space / Caps Lock 多被屏蔽，切不回 ABC；锁屏界面也没有输入法配置页可点。不要在锁屏上反复尝试或建议用户「切换输入法」，直接改配置。
- 想「桌面保留中文、锁屏只有 ABC」，只能改 /Library 级 plist：macOS **没有**独立的锁屏输入法设置项，图形界面（系统设置→键盘→输入法）改的是全局/用户级，删拼音会连带桌面也失去中文。
- 改完 `/Library/.../HIToolbox.plist` 后，磁盘改对了但 loginwindow 内存里仍是旧状态，必须 `launchctl kickstart -k system/com.apple.loginwindow`（会结束当前图形会话，先确认无未保存内容）或重启机器才生效。
- 修法：备份后用 python3 `plistlib` 把 `AppleEnabledInputSources` / `AppleSelectedInputSources` 重置为 ABC（`KeyboardLayout ID 252`）、`AppleCurrentKeyboardLayoutInputSourceID` 设 `com.apple.keylayout.ABC`、删 `AppleInputSourceHistory`，再 `killall -HUP cfprefsd`。**必须重启 loginwindow 或重启机器**才真正生效。
- 动手前先确认密码没变：另开一条 `ssh` 用密码能否登录。能登 = 纯输入法问题，**不要引导用户重置密码**（每错一次都在逼近账号锁定）。

## 顺带查的安全基线
FileVault 状态、应用防火墙（`socketfilterfw --getglobalstate` 经常是 off）、22 端口是否暴露公网、`~/.ssh/authorized_keys` 是否存在。

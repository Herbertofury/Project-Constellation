$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
try { Add-Type -AssemblyName UIAutomationClient; Add-Type -AssemblyName UIAutomationTypes } catch {}

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public sealed class CCWindowInfo {
  public long Handle { get; set; }
  public int Pid { get; set; }
  public string Title { get; set; }
  public string ProcessName { get; set; }
  public int X { get; set; }
  public int Y { get; set; }
  public int Width { get; set; }
  public int Height { get; set; }
  public bool Minimized { get; set; }
  public bool Foreground { get; set; }
}

public static class CCNative {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr param);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll", EntryPoint="SetProcessDpiAwarenessContext")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmdShow);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extraInfo);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extraInfo);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern short VkKeyScan(char ch);
  public const int SW_RESTORE = 9;
  public const int SW_MINIMIZE = 6;
  public const int SW_MAXIMIZE = 3;
  public const uint WM_CLOSE = 0x0010;
  public const uint MOUSEEVENTF_LEFTDOWN=0x0002, MOUSEEVENTF_LEFTUP=0x0004, MOUSEEVENTF_RIGHTDOWN=0x0008, MOUSEEVENTF_RIGHTUP=0x0010, MOUSEEVENTF_MIDDLEDOWN=0x0020, MOUSEEVENTF_MIDDLEUP=0x0040, MOUSEEVENTF_WHEEL=0x0800, MOUSEEVENTF_HWHEEL=0x01000;
  public const uint KEYEVENTF_KEYUP=0x0002;

  public static List<CCWindowInfo> GetWindows() {
    var result = new List<CCWindowInfo>();
    IntPtr foreground = GetForegroundWindow();
    EnumWindows((hWnd, lParam) => {
      if (!IsWindowVisible(hWnd)) return true;
      int len = GetWindowTextLength(hWnd);
      if (len <= 0) return true;
      var sb = new StringBuilder(len + 1);
      GetWindowText(hWnd, sb, sb.Capacity);
      string title = sb.ToString().Trim();
      if (title.Length == 0) return true;
      RECT r; if (!GetWindowRect(hWnd, out r)) return true;
      uint pid; GetWindowThreadProcessId(hWnd, out pid);
      string processName = "";
      try { processName = Process.GetProcessById((int)pid).ProcessName; } catch {}
      result.Add(new CCWindowInfo { Handle=hWnd.ToInt64(), Pid=(int)pid, Title=title, ProcessName=processName, X=r.Left, Y=r.Top, Width=Math.Max(0,r.Right-r.Left), Height=Math.Max(0,r.Bottom-r.Top), Minimized=IsIconic(hWnd), Foreground=hWnd==foreground });
      return true;
    }, IntPtr.Zero);
    return result;
  }
}
'@

# Keep screenshot pixels, mouse coordinates, window bounds, and UIA bounds in the same
# physical-coordinate space on scaled/mixed-DPI desktops. Per-monitor-v2 is preferred;
# older Windows falls back to system-DPI awareness.
try { [CCNative]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null } catch { try { [CCNative]::SetProcessDPIAware() | Out-Null } catch {} }

function Out-Response($Id, $Ok, $Result, $ErrorMessage) {
  $obj = if ($Ok) { [ordered]@{ id=$Id; ok=$true; result=$Result } } else { [ordered]@{ id=$Id; ok=$false; error=$ErrorMessage } }
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 20))
  [Console]::Out.Flush()
}

function Get-Arg($ArgsObj, [string]$Name, $Default=$null) {
  if ($null -ne $ArgsObj -and $ArgsObj.PSObject.Properties.Name -contains $Name) { return $ArgsObj.$Name }
  return $Default
}

function Get-WindowHandle($ArgsObj) {
  $raw = Get-Arg $ArgsObj 'handle' $null
  if ($null -ne $raw -and "$raw" -ne '') {
    $s = "$raw"
    if ($s.StartsWith('0x')) { return [IntPtr]([Convert]::ToInt64($s.Substring(2),16)) }
    return [IntPtr]([Int64]$raw)
  }
  $title = [string](Get-Arg $ArgsObj 'title' '')
  $pid = [int](Get-Arg $ArgsObj 'pid' 0)
  $windows = [CCNative]::GetWindows()
  $match = $windows | Where-Object { ($pid -le 0 -or $_.Pid -eq $pid) -and ([string]::IsNullOrWhiteSpace($title) -or $_.Title.IndexOf($title,[StringComparison]::OrdinalIgnoreCase) -ge 0) } | Select-Object -First 1
  if ($null -eq $match) { throw 'No matching window was found.' }
  return [IntPtr]$match.Handle
}

function Get-Bounds($ArgsObj) {
  $mode = [string](Get-Arg $ArgsObj 'target' 'all')
  if ($mode -eq 'region') {
    return [Drawing.Rectangle]::new([int](Get-Arg $ArgsObj 'x' 0), [int](Get-Arg $ArgsObj 'y' 0), [int](Get-Arg $ArgsObj 'width' 1), [int](Get-Arg $ArgsObj 'height' 1))
  }
  if ($mode -eq 'window') {
    $h = Get-WindowHandle $ArgsObj
    $r = New-Object CCNative+RECT
    if (-not [CCNative]::GetWindowRect($h,[ref]$r)) { throw 'GetWindowRect failed.' }
    return [Drawing.Rectangle]::new($r.Left,$r.Top,[Math]::Max(1,$r.Right-$r.Left),[Math]::Max(1,$r.Bottom-$r.Top))
  }
  $screens = [System.Windows.Forms.Screen]::AllScreens
  if ($mode -eq 'monitor') {
    $idx = [int](Get-Arg $ArgsObj 'monitor' 0)
    if ($idx -lt 0 -or $idx -ge $screens.Count) { throw "Monitor index $idx is out of range." }
    return $screens[$idx].Bounds
  }
  $left = ($screens | ForEach-Object { $_.Bounds.Left } | Measure-Object -Minimum).Minimum
  $top = ($screens | ForEach-Object { $_.Bounds.Top } | Measure-Object -Minimum).Minimum
  $right = ($screens | ForEach-Object { $_.Bounds.Right } | Measure-Object -Maximum).Maximum
  $bottom = ($screens | ForEach-Object { $_.Bounds.Bottom } | Measure-Object -Maximum).Maximum
  return [Drawing.Rectangle]::new($left,$top,$right-$left,$bottom-$top)
}

function Capture-Screenshot($ArgsObj) {
  $bounds = Get-Bounds $ArgsObj
  if ($bounds.Width -le 0 -or $bounds.Height -le 0) { throw 'Screenshot bounds are empty.' }
  $bmp = [Drawing.Bitmap]::new($bounds.Width,$bounds.Height,[Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [Drawing.Graphics]::FromImage($bmp)
  try { $g.CopyFromScreen($bounds.Left,$bounds.Top,0,0,$bounds.Size,[Drawing.CopyPixelOperation]::SourceCopy) } finally { $g.Dispose() }
  $maxWidth = [int](Get-Arg $ArgsObj 'max_width' 1600)
  $maxHeight = [int](Get-Arg $ArgsObj 'max_height' 1200)
  $final = $bmp
  if (($maxWidth -gt 0 -and $bmp.Width -gt $maxWidth) -or ($maxHeight -gt 0 -and $bmp.Height -gt $maxHeight)) {
    $scale = [Math]::Min($(if($maxWidth -gt 0){$maxWidth/$bmp.Width}else{1}), $(if($maxHeight -gt 0){$maxHeight/$bmp.Height}else{1}))
    $nw=[Math]::Max(1,[int]($bmp.Width*$scale)); $nh=[Math]::Max(1,[int]($bmp.Height*$scale))
    $resized=[Drawing.Bitmap]::new($nw,$nh)
    $rg=[Drawing.Graphics]::FromImage($resized)
    try { $rg.DrawImage($bmp,0,0,$nw,$nh) } finally { $rg.Dispose() }
    $final=$resized
  }
  $format=[string](Get-Arg $ArgsObj 'format' 'jpeg')
  $ms=[IO.MemoryStream]::new()
  try {
    if ($format -eq 'png') { $final.Save($ms,[Drawing.Imaging.ImageFormat]::Png); $mime='image/png'; $name='computer-screenshot.png' }
    else { $final.Save($ms,[Drawing.Imaging.ImageFormat]::Jpeg); $mime='image/jpeg'; $name='computer-screenshot.jpg' }
    $bytes=$ms.ToArray()
    return [ordered]@{ x=$bounds.Left; y=$bounds.Top; source_width=$bounds.Width; source_height=$bounds.Height; width=$final.Width; height=$final.Height; mimeType=$mime; name=$name; bytes=$bytes.Length; base64=[Convert]::ToBase64String($bytes) }
  } finally { $ms.Dispose(); if($final -ne $bmp){$final.Dispose()}; $bmp.Dispose() }
}

function Get-Vk([string]$Key) {
  $k=$Key.Trim().ToLowerInvariant()
  $map=@{ ctrl=0x11; control=0x11; shift=0x10; alt=0x12; win=0x5B; windows=0x5B; enter=0x0D; return=0x0D; tab=0x09; esc=0x1B; escape=0x1B; space=0x20; backspace=0x08; delete=0x2E; insert=0x2D; up=0x26; down=0x28; left=0x25; right=0x27; home=0x24; end=0x23; pageup=0x21; pagedown=0x22 }
  if ($map.ContainsKey($k)) { return [byte]$map[$k] }
  if ($k -match '^f([1-9]|1[0-9]|2[0-4])$') { return [byte](0x70 + [int]$Matches[1] - 1) }
  if ($Key.Length -eq 1) { return [byte]([CCNative]::VkKeyScan($Key[0]) -band 0xFF) }
  throw "Unsupported key: $Key"
}
function Key-Down([byte]$Vk){ [CCNative]::keybd_event($Vk,0,0,[UIntPtr]::Zero) }
function Key-Up([byte]$Vk){ [CCNative]::keybd_event($Vk,0,[CCNative]::KEYEVENTF_KEYUP,[UIntPtr]::Zero) }
function Send-Hotkey($Keys) { $vks=@($Keys | ForEach-Object { Get-Vk ([string]$_) }); foreach($vk in $vks){Key-Down $vk}; Start-Sleep -Milliseconds 25; [Array]::Reverse($vks); foreach($vk in $vks){Key-Up $vk} }
function Click-Mouse([string]$Button='left') {
  switch ($Button.ToLowerInvariant()) {
    'right' { [CCNative]::mouse_event([CCNative]::MOUSEEVENTF_RIGHTDOWN,0,0,0,[UIntPtr]::Zero); [CCNative]::mouse_event([CCNative]::MOUSEEVENTF_RIGHTUP,0,0,0,[UIntPtr]::Zero) }
    'middle' { [CCNative]::mouse_event([CCNative]::MOUSEEVENTF_MIDDLEDOWN,0,0,0,[UIntPtr]::Zero); [CCNative]::mouse_event([CCNative]::MOUSEEVENTF_MIDDLEUP,0,0,0,[UIntPtr]::Zero) }
    default { [CCNative]::mouse_event([CCNative]::MOUSEEVENTF_LEFTDOWN,0,0,0,[UIntPtr]::Zero); [CCNative]::mouse_event([CCNative]::MOUSEEVENTF_LEFTUP,0,0,0,[UIntPtr]::Zero) }
  }
}
function Do-Action($Action) {
  $type=[string](Get-Arg $Action 'type' '')
  switch ($type) {
    'move' { [CCNative]::SetCursorPos([int]$Action.x,[int]$Action.y) | Out-Null }
    'click' { if($null -ne $Action.x -and $null -ne $Action.y){[CCNative]::SetCursorPos([int]$Action.x,[int]$Action.y)|Out-Null}; Click-Mouse ([string](Get-Arg $Action 'button' 'left')) }
    'double_click' { if($null -ne $Action.x -and $null -ne $Action.y){[CCNative]::SetCursorPos([int]$Action.x,[int]$Action.y)|Out-Null}; Click-Mouse ([string](Get-Arg $Action 'button' 'left')); Start-Sleep -Milliseconds 90; Click-Mouse ([string](Get-Arg $Action 'button' 'left')) }
    'drag' {
      $sx=[int]$Action.from_x; $sy=[int]$Action.from_y; $tx=[int]$Action.to_x; $ty=[int]$Action.to_y; $steps=[Math]::Max(2,[int](Get-Arg $Action 'steps' 12));
      [CCNative]::SetCursorPos($sx,$sy)|Out-Null; [CCNative]::mouse_event([CCNative]::MOUSEEVENTF_LEFTDOWN,0,0,0,[UIntPtr]::Zero)
      for($i=1;$i -le $steps;$i++){[CCNative]::SetCursorPos([int]($sx+($tx-$sx)*$i/$steps),[int]($sy+($ty-$sy)*$i/$steps))|Out-Null; Start-Sleep -Milliseconds 12}
      [CCNative]::mouse_event([CCNative]::MOUSEEVENTF_LEFTUP,0,0,0,[UIntPtr]::Zero)
    }
    'scroll' { $amount=[int](Get-Arg $Action 'amount' 0); $horizontal=[bool](Get-Arg $Action 'horizontal' $false); [CCNative]::mouse_event($(if($horizontal){[CCNative]::MOUSEEVENTF_HWHEEL}else{[CCNative]::MOUSEEVENTF_WHEEL}),0,0,$amount*120,[UIntPtr]::Zero) }
    'keypress' { $vk=Get-Vk ([string]$Action.key); $repeat=[Math]::Max(1,[int](Get-Arg $Action 'repeat' 1)); for($i=0;$i -lt $repeat;$i++){Key-Down $vk; Key-Up $vk; Start-Sleep -Milliseconds 20} }
    'hotkey' { Send-Hotkey @($Action.keys) }
    'type' {
      $text=[string](Get-Arg $Action 'text' '')
      if($text.Length -gt 0){
        $saved=$null; try {$saved=[Windows.Forms.Clipboard]::GetDataObject()}catch{}
        [Windows.Forms.Clipboard]::SetText($text)
        Start-Sleep -Milliseconds 30; Send-Hotkey @('ctrl','v'); Start-Sleep -Milliseconds ([Math]::Max(80,[int](Get-Arg $Action 'settle_ms' 120)))
        if($null -ne $saved){try{[Windows.Forms.Clipboard]::SetDataObject($saved,$true)}catch{}}
      }
    }
    'wait' { Start-Sleep -Milliseconds ([Math]::Max(0,[int](Get-Arg $Action 'ms' 500))) }
    default { throw "Unknown computer action type: $type" }
  }
}

function Get-UIElements($ArgsObj) {
  if (-not ('System.Windows.Automation.AutomationElement' -as [type])) { throw 'Windows UI Automation assemblies are unavailable.' }
  $root = if ($null -ne (Get-Arg $ArgsObj 'window_handle' $null)) { [System.Windows.Automation.AutomationElement]::FromHandle((Get-WindowHandle ([pscustomobject]@{handle=$ArgsObj.window_handle}))) } else { [System.Windows.Automation.AutomationElement]::RootElement }
  $query=[string](Get-Arg $ArgsObj 'query' ''); $name=[string](Get-Arg $ArgsObj 'name' ''); $automationId=[string](Get-Arg $ArgsObj 'automation_id' ''); $className=[string](Get-Arg $ArgsObj 'class_name' ''); $controlType=[string](Get-Arg $ArgsObj 'control_type' '')
  $max=[Math]::Min(500,[Math]::Max(1,[int](Get-Arg $ArgsObj 'max_results' 80))); $depthLimit=[Math]::Min(20,[Math]::Max(0,[int](Get-Arg $ArgsObj 'max_depth' 8)))
  $walker=[System.Windows.Automation.TreeWalker]::ControlViewWalker
  $queue=[Collections.Generic.Queue[object]]::new(); $queue.Enqueue([pscustomobject]@{e=$root;d=0})
  $out=[Collections.Generic.List[object]]::new(); $visited=0
  while($queue.Count -gt 0 -and $out.Count -lt $max -and $visited -lt 5000){
    $item=$queue.Dequeue(); $e=$item.e; $d=[int]$item.d; $visited++
    try {
      $cn=$e.Current.Name; $aid=$e.Current.AutomationId; $cls=$e.Current.ClassName; $ct=$e.Current.ControlType.ProgrammaticName -replace '^ControlType\.',''; $r=$e.Current.BoundingRectangle
      $hay="$cn $aid $cls $ct"; $matches=$true
      if($query){$matches=$matches -and ($hay.IndexOf($query,[StringComparison]::OrdinalIgnoreCase)-ge 0)}
      if($name){$matches=$matches -and ($cn.IndexOf($name,[StringComparison]::OrdinalIgnoreCase)-ge 0)}
      if($automationId){$matches=$matches -and ($aid -eq $automationId)}
      if($className){$matches=$matches -and ($cls.IndexOf($className,[StringComparison]::OrdinalIgnoreCase)-ge 0)}
      if($controlType){$matches=$matches -and ($ct.IndexOf($controlType,[StringComparison]::OrdinalIgnoreCase)-ge 0)}
      if($matches -and $e -ne $root){ $out.Add([ordered]@{name=$cn;automationId=$aid;className=$cls;controlType=$ct;enabled=$e.Current.IsEnabled;offscreen=$e.Current.IsOffscreen;x=[int]$r.X;y=[int]$r.Y;width=[int]$r.Width;height=[int]$r.Height;depth=$d}) }
      if($d -lt $depthLimit){ $child=$walker.GetFirstChild($e); while($null -ne $child){$queue.Enqueue([pscustomobject]@{e=$child;d=$d+1});$child=$walker.GetNextSibling($child)} }
    } catch {}
  }
  return [ordered]@{elements=$out;visited=$visited;truncated=($queue.Count -gt 0)}
}

function Invoke-Command($Command, $ArgsObj) {
  switch ($Command) {
    'displays' {
      $screens=@([Windows.Forms.Screen]::AllScreens | ForEach-Object { [ordered]@{deviceName=$_.DeviceName;primary=$_.Primary;x=$_.Bounds.X;y=$_.Bounds.Y;width=$_.Bounds.Width;height=$_.Bounds.Height;workX=$_.WorkingArea.X;workY=$_.WorkingArea.Y;workWidth=$_.WorkingArea.Width;workHeight=$_.WorkingArea.Height} })
      return [ordered]@{displays=$screens}
    }
    'cursor' { $p=New-Object CCNative+POINT; [CCNative]::GetCursorPos([ref]$p)|Out-Null; return [ordered]@{x=$p.X;y=$p.Y} }
    'windows' { return [ordered]@{windows=@([CCNative]::GetWindows() | Sort-Object -Property Foreground -Descending | Select-Object -First ([Math]::Min(300,[Math]::Max(1,[int](Get-Arg $ArgsObj 'limit' 120)))))} }
    'focus_window' { $h=Get-WindowHandle $ArgsObj; [CCNative]::ShowWindow($h,[CCNative]::SW_RESTORE)|Out-Null; [CCNative]::BringWindowToTop($h)|Out-Null; $ok=[CCNative]::SetForegroundWindow($h); return [ordered]@{handle=$h.ToInt64();focused=$ok} }
    'window_state' { $h=Get-WindowHandle $ArgsObj; $state=[string](Get-Arg $ArgsObj 'state' 'restore'); $cmd=switch($state){'minimize'{[CCNative]::SW_MINIMIZE};'maximize'{[CCNative]::SW_MAXIMIZE};default{[CCNative]::SW_RESTORE}}; $ok=[CCNative]::ShowWindow($h,$cmd); return [ordered]@{handle=$h.ToInt64();state=$state;ok=$ok} }
    'close_window' { $h=Get-WindowHandle $ArgsObj; $ok=[CCNative]::PostMessage($h,[CCNative]::WM_CLOSE,[IntPtr]::Zero,[IntPtr]::Zero); return [ordered]@{handle=$h.ToInt64();closeRequested=$ok} }
    'screenshot' { return Capture-Screenshot $ArgsObj }
    'actions' { foreach($a in @($ArgsObj.actions)){Do-Action $a}; return [ordered]@{actionsExecuted=@($ArgsObj.actions).Count} }
    'clipboard_read' { $text=''; if([Windows.Forms.Clipboard]::ContainsText()){$text=[Windows.Forms.Clipboard]::GetText()}; return [ordered]@{text=$text} }
    'clipboard_write' { $text=[string](Get-Arg $ArgsObj 'text' ''); if($text.Length -eq 0){[Windows.Forms.Clipboard]::Clear()}else{[Windows.Forms.Clipboard]::SetText($text)}; return [ordered]@{written=$true;characters=$text.Length} }
    'ui_elements' { return Get-UIElements $ArgsObj }
    default { throw "Unknown computer-use command: $Command" }
  }
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  $id=''
  try {
    $req=$line | ConvertFrom-Json
    $id=[string]$req.id
    $result=Invoke-Command ([string]$req.command) $req.args
    Out-Response $id $true $result $null
  } catch {
    Out-Response $id $false $null ([string]$_.Exception.Message)
  }
}

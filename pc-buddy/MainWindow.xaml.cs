using Microsoft.Web.WebView2.Wpf;
using PCBuddy.Core;
using System;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;

namespace PCBuddy;

public partial class MainWindow : Window
{
    private readonly PortableStore _store;
    private readonly AppSettings _settings;
    private readonly ToolBroker _tools;
    private readonly bool _skipChatSession;
    private WebView2? _webView;
    private ChatGptSessionHost? _chatSession;
    private bool _chatReady;

    public ObservableCollection<ActivityEntry> Activities { get; } = new();

    public MainWindow(bool skipChatSession = false)
    {
        InitializeComponent();
        DataContext = this;
        _skipChatSession = skipChatSession;
        _store = new PortableStore();
        _settings = _store.LoadSettings();
        _tools = new ToolBroker(() => _settings, RecordActivity);
        LoadSettingsIntoUi();
        SetPage("Home");
    }

    private async void Window_Loaded(object sender, RoutedEventArgs e)
    {
        PortableModeText.Text = _store.IsPortable ? "Portable data mode" : "Portable fallback mode";
        DataPathText.Text = _store.DataDirectory;
        SessionProfilePathText.Text = $"ChatGPT profile: {_store.DataDirectory}\\chatgpt-session";
        RefreshStatus();

        if (_skipChatSession)
        {
            UpdateChatStatus("UI smoke mode — ChatGPT session intentionally not started.", false);
            return;
        }

        try
        {
            _webView = new WebView2();
            ChatHost.Children.Add(_webView);
            _chatSession = new ChatGptSessionHost(
                _webView,
                _tools,
                _store.DataDirectory,
                UpdateChatStatus,
                RecordActivity);
            await _chatSession.InitializeAsync();
        }
        catch (Exception ex)
        {
            RecordActivity("chatgpt_session", ex.Message, false);
            UpdateChatStatus($"Could not start the embedded ChatGPT session: {ex.Message}", false);
        }
    }

    private void Window_Closed(object? sender, EventArgs e)
    {
        try { _chatSession?.Dispose(); } catch { }
    }

    private void LoadSettingsIntoUi()
    {
        DesktopCheck.IsChecked = _settings.AllowDesktop;
        DocumentsCheck.IsChecked = _settings.AllowDocuments;
        DownloadsCheck.IsChecked = _settings.AllowDownloads;
        ProcessCheck.IsChecked = _settings.AllowProcessInspection;
        IdentityCheck.IsChecked = _settings.AllowIdentity;
        HostnameCheck.IsChecked = _settings.AllowHostname;
        IpConfigCheck.IsChecked = _settings.AllowIpConfig;
        SystemInfoCheck.IsChecked = _settings.AllowSystemInfo;
        AutoStartCheck.IsChecked = _settings.AutoStart;
        RefreshStatus();
    }

    private void Nav_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: string page }) SetPage(page);
    }

    private void GoChat_Click(object sender, RoutedEventArgs e) => SetPage("Chat");

    private void SetPage(string page)
    {
        HomePage.Visibility = page == "Home" ? Visibility.Visible : Visibility.Collapsed;
        ChatPage.Visibility = page == "Chat" ? Visibility.Visible : Visibility.Collapsed;
        AccessPage.Visibility = page == "Access" ? Visibility.Visible : Visibility.Collapsed;
        ActivityPage.Visibility = page == "Activity" ? Visibility.Visible : Visibility.Collapsed;
        SettingsPage.Visibility = page == "Settings" ? Visibility.Visible : Visibility.Collapsed;

        (PageTitle.Text, PageSubtitle.Text) = page switch
        {
            "Chat" => ("Buddy Chat", "Your normal ChatGPT session with guarded local PC tools"),
            "Access" => ("Access", "Choose exactly what the local bridge can inspect"),
            "Activity" => ("Activity", "Observed local tool calls and outcomes"),
            "Settings" => ("Settings", "ChatGPT session, startup, and portable data"),
            _ => ("Home", "Your normal ChatGPT session with guarded local PC tools")
        };
    }

    private void UpdateChatStatus(string message, bool ready)
    {
        if (!Dispatcher.CheckAccess())
        {
            Dispatcher.Invoke(() => UpdateChatStatus(message, ready));
            return;
        }

        _chatReady = ready;
        ChatSessionStatusText.Text = message;
        ChatSessionHomeStatusText.Text = ready ? "Connected" : "Needs attention";
        RefreshStatus();
    }

    private void RefreshStatus()
    {
        var locked = _settings.EmergencyLocked;
        HeaderStatusText.Text = locked ? "LOCKED" : _chatReady ? "BUDDY READY" : "CHATGPT SESSION";
        StatusPill.Background = locked
            ? (System.Windows.Media.Brush)FindResource("CardBrush")
            : (System.Windows.Media.Brush)FindResource("AccentDarkBrush");
        HeaderStatusText.Foreground = locked
            ? (System.Windows.Media.Brush)FindResource("DangerBrush")
            : (System.Windows.Media.Brush)FindResource("AccentBrush");
        EmergencyButton.Content = locked ? "Unlock Local Tools" : "Emergency Lock";
        LocalToolsStatusText.Text = locked ? "Locked" : "Ready";
        AccessStatusText.Text = locked ? "Emergency locked" : "Read-only guarded";
    }

    private void SaveAccess_Click(object sender, RoutedEventArgs e)
    {
        _settings.AllowDesktop = DesktopCheck.IsChecked == true;
        _settings.AllowDocuments = DocumentsCheck.IsChecked == true;
        _settings.AllowDownloads = DownloadsCheck.IsChecked == true;
        _settings.AllowProcessInspection = ProcessCheck.IsChecked == true;
        _settings.AllowIdentity = IdentityCheck.IsChecked == true;
        _settings.AllowHostname = HostnameCheck.IsChecked == true;
        _settings.AllowIpConfig = IpConfigCheck.IsChecked == true;
        _settings.AllowSystemInfo = SystemInfoCheck.IsChecked == true;
        _store.SaveSettings(_settings);
        RecordActivity("policy", "Access policy saved", true);
        RefreshStatus();
    }

    private void SaveSettings_Click(object sender, RoutedEventArgs e)
    {
        _settings.AutoStart = AutoStartCheck.IsChecked == true;
        try
        {
            _store.SetAutoStart(_settings.AutoStart);
            _store.SaveSettings(_settings);
            RecordActivity("settings", _settings.AutoStart ? "Windows autostart enabled" : "Windows autostart disabled", true);
        }
        catch (Exception ex)
        {
            RecordActivity("autostart", ex.Message, false);
        }
    }

    private void OpenData_Click(object sender, RoutedEventArgs e) => _store.OpenDataFolder();

    private void EmergencyLock_Click(object sender, RoutedEventArgs e)
    {
        _settings.EmergencyLocked = !_settings.EmergencyLocked;
        _store.SaveSettings(_settings);
        RecordActivity("emergency_lock", _settings.EmergencyLocked ? "Local tools locked" : "Local tools unlocked", true);
        RefreshStatus();
    }

    private void ReloadChat_Click(object sender, RoutedEventArgs e)
    {
        _chatSession?.Reload();
        RecordActivity("chatgpt_session", "Reload requested", true);
    }

    private void NewBuddyChat_Click(object sender, RoutedEventArgs e)
    {
        _chatSession?.NewBuddyChat();
        RecordActivity("chatgpt_session", "Fresh Buddy conversation requested", true);
    }

    private void OpenChatGptBrowser_Click(object sender, RoutedEventArgs e) =>
        Process.Start(new ProcessStartInfo("https://chatgpt.com/") { UseShellExecute = true });

    private void RecordActivity(string tool, string detail, bool ok)
    {
        if (!Dispatcher.CheckAccess())
        {
            Dispatcher.Invoke(() => RecordActivity(tool, detail, ok));
            return;
        }

        var entry = new ActivityEntry(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"), tool, (ok ? "✓ " : "✕ ") + detail);
        Activities.Insert(0, entry);
        while (Activities.Count > 250) Activities.RemoveAt(Activities.Count - 1);
        _store.AppendActivity(new { time = DateTimeOffset.Now, tool, detail, ok });
    }
}

public sealed record ActivityEntry(string Time, string Tool, string Detail);

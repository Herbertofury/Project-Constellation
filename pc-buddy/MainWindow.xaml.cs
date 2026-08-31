using Microsoft.Web.WebView2.Wpf;
using Microsoft.Win32;
using PCBuddy.Core;
using System;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Controls;

namespace PCBuddy;

public partial class MainWindow : Window
{
    private readonly PortableStore _store;
    private readonly ProjectWorkspaceStore _projectStore;
    private readonly AppSettings _settings;
    private readonly ToolBroker _tools;
    private readonly LocalCompanionServer _localCompanion;
    private readonly bool _skipChatSession;
    private WebView2? _webView;
    private ChatGptSessionHost? _chatSession;
    private bool _chatReady;
    private bool _browserCompanionReady;

    public ObservableCollection<ActivityEntry> Activities { get; } = new();
    public ObservableCollection<ProjectWorkspace> Projects { get; } = new();

    public MainWindow(bool skipChatSession = false)
    {
        InitializeComponent();
        DataContext = this;
        _skipChatSession = skipChatSession;
        _store = new PortableStore();
        _projectStore = new ProjectWorkspaceStore(_store.DataDirectory);
        _settings = _store.LoadSettings();
        _tools = new ToolBroker(() => _settings, RecordActivity);
        _localCompanion = new LocalCompanionServer(_tools, () => _settings, RecordActivity);

        foreach (var project in _projectStore.Load()) Projects.Add(project);
        if (Projects.Count == 0)
        {
            Projects.Add(new ProjectWorkspace { Name = "New Project" });
            SaveProjects();
        }

        LoadSettingsIntoUi();
        SetPage("Home");
        ProjectTabs.SelectedItem = Projects.FirstOrDefault();
    }

    private async void Window_Loaded(object sender, RoutedEventArgs e)
    {
        PortableModeText.Text = _store.IsPortable ? "Portable data mode" : "Portable fallback mode";
        DataPathText.Text = _store.DataDirectory;
        SessionProfilePathText.Text = $"ChatGPT profile: {_store.DataDirectory}\\chatgpt-session";
        ProjectCountText.Text = Projects.Count == 1 ? "1 project" : $"{Projects.Count} projects";
        RefreshStatus();

        if (_skipChatSession)
        {
            UpdateChatStatus("UI smoke mode — ChatGPT session intentionally not started.", false);
            UpdateBrowserCompanionStatus("UI smoke mode", false);
            return;
        }

        try
        {
            await _localCompanion.StartAsync();
            _browserCompanionReady = _localCompanion.IsRunning;
            UpdateBrowserCompanionStatus(_browserCompanionReady
                ? $"Ready on 127.0.0.1:{_localCompanion.Port}"
                : "Disabled by policy", _browserCompanionReady);
        }
        catch (Exception ex)
        {
            RecordActivity("browser_companion", ex.Message, false);
            UpdateBrowserCompanionStatus($"Unavailable: {ex.Message}", false);
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

    private async void Window_Closed(object? sender, EventArgs e)
    {
        try { SaveProjects(); } catch { }
        try { _chatSession?.Dispose(); } catch { }
        try { await _localCompanion.DisposeAsync(); } catch { }
    }

    private void LoadSettingsIntoUi()
    {
        DesktopCheck.IsChecked = _settings.AllowDesktop;
        DocumentsCheck.IsChecked = _settings.AllowDocuments;
        DownloadsCheck.IsChecked = _settings.AllowDownloads;
        ProcessCheck.IsChecked = _settings.AllowProcessInspection;
        BrowserCompanionCheck.IsChecked = _settings.AllowBrowserCompanion;
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
    private void GoProjects_Click(object sender, RoutedEventArgs e) => SetPage("Projects");

    private void SetPage(string page)
    {
        HomePage.Visibility = page == "Home" ? Visibility.Visible : Visibility.Collapsed;
        ProjectsPage.Visibility = page == "Projects" ? Visibility.Visible : Visibility.Collapsed;
        ChatPage.Visibility = page == "Chat" ? Visibility.Visible : Visibility.Collapsed;
        AccessPage.Visibility = page == "Access" ? Visibility.Visible : Visibility.Collapsed;
        ActivityPage.Visibility = page == "Activity" ? Visibility.Visible : Visibility.Collapsed;
        SettingsPage.Visibility = page == "Settings" ? Visibility.Visible : Visibility.Collapsed;

        (PageTitle.Text, PageSubtitle.Text) = page switch
        {
            "Projects" => ("Projects", "Persist chats, workspaces, checkpoints, blockers, and exact next actions"),
            "Chat" => ("ChatGPT Workspace", "Your normal ChatGPT session with guarded local PC tools"),
            "Access" => ("Access", "Choose exactly what Project Constellation can inspect"),
            "Activity" => ("Activity", "Observed local tool calls and outcomes"),
            "Settings" => ("Settings", "ChatGPT session, startup, and portable data"),
            _ => ("Home", "One workspace for ChatGPT, projects, and guarded local PC tools")
        };
    }

    private void AddProject_Click(object sender, RoutedEventArgs e)
    {
        var project = new ProjectWorkspace { Name = "New Project" };
        Projects.Add(project);
        project.Touch();
        SaveProjects();
        ProjectTabs.SelectedItem = project;
        SetPage("Projects");
        ProjectCountText.Text = Projects.Count == 1 ? "1 project" : $"{Projects.Count} projects";
        RecordActivity("project", $"created {project.Name}", true);
    }

    private void SaveProject_Click(object sender, RoutedEventArgs e)
    {
        if (ProjectFromSender(sender) is not { } project) return;
        project.Name = string.IsNullOrWhiteSpace(project.Name) ? "Untitled Project" : project.Name.Trim();
        project.Touch();
        SaveProjects();
        ProjectCountText.Text = Projects.Count == 1 ? "1 project" : $"{Projects.Count} projects";
        RecordActivity("project", $"saved {project.Name}", true);
    }

    private void DeleteProject_Click(object sender, RoutedEventArgs e)
    {
        if (ProjectFromSender(sender) is not { } project) return;
        if (MessageBox.Show(this, $"Delete the Project Constellation tab '{project.Name}'?\n\nThis removes only its saved Constellation metadata. It does not delete local files, ChatGPT chats, GitHub repositories, or Drive files.",
                "Delete project tab", MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes) return;
        Projects.Remove(project);
        if (Projects.Count == 0) Projects.Add(new ProjectWorkspace { Name = "New Project" });
        SaveProjects();
        ProjectTabs.SelectedItem = Projects.FirstOrDefault();
        ProjectCountText.Text = Projects.Count == 1 ? "1 project" : $"{Projects.Count} projects";
        RecordActivity("project", $"removed tab {project.Name}", true);
    }

    private void CaptureProjectChat_Click(object sender, RoutedEventArgs e)
    {
        if (ProjectFromSender(sender) is not { } project) return;
        var current = _chatSession?.CurrentUrl ?? string.Empty;
        if (!ChatGptSessionHost.TryNormalizeChatUrl(current, out var normalized))
        {
            RecordActivity("project_chat", "current embedded page is not a ChatGPT conversation", false);
            MessageBox.Show(this, "Open the ChatGPT conversation you want inside Project Constellation first, then click Capture current chat.", "No ChatGPT chat to capture", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }
        project.ChatUrl = normalized;
        project.Touch();
        SaveProjects();
        RecordActivity("project_chat", $"captured current ChatGPT URL for {project.Name}", true);
    }

    private void OpenProjectChat_Click(object sender, RoutedEventArgs e)
    {
        if (ProjectFromSender(sender) is not { } project) return;
        if (_chatSession?.OpenChat(project.ChatUrl) != true)
        {
            RecordActivity("project_chat", $"invalid or unavailable ChatGPT URL for {project.Name}", false);
            MessageBox.Show(this, "This project does not have a valid ChatGPT URL yet.", "ChatGPT link missing", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }
        SetPage("Chat");
        RecordActivity("project_chat", $"opened {project.Name} in ChatGPT Workspace", true);
    }

    private void OpenProjectChatBrowser_Click(object sender, RoutedEventArgs e)
    {
        if (ProjectFromSender(sender) is not { } project) return;
        if (!ChatGptSessionHost.TryNormalizeChatUrl(project.ChatUrl, out var normalized))
        {
            RecordActivity("project_chat", $"invalid ChatGPT URL for {project.Name}", false);
            return;
        }
        OpenExternal(normalized, "chatgpt.com", "chat.openai.com");
    }

    private void OpenRelatedChats_Click(object sender, RoutedEventArgs e)
    {
        if (ProjectFromSender(sender) is not { } project) return;
        var urls = (project.RelatedChatUrls ?? string.Empty)
            .Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(value => value.Trim())
            .Where(value => ChatGptSessionHost.TryNormalizeChatUrl(value, out _))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(10)
            .ToArray();
        foreach (var url in urls) OpenExternal(url, "chatgpt.com", "chat.openai.com");
        RecordActivity("project_chat", $"opened {urls.Length} related ChatGPT link(s) for {project.Name}", true);
    }

    private void BrowseProjectRoot_Click(object sender, RoutedEventArgs e)
    {
        if (ProjectFromSender(sender) is not { } project) return;
        var dialog = new OpenFolderDialog
        {
            Title = $"Choose local workspace for {project.Name}",
            Multiselect = false,
            InitialDirectory = Directory.Exists(project.LocalRoot) ? project.LocalRoot : Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
        };
        if (dialog.ShowDialog(this) != true) return;
        project.LocalRoot = dialog.FolderName;
        project.Touch();
        SaveProjects();
        RecordActivity("project_root", $"linked local workspace for {project.Name}", true);
    }

    private void OpenProjectRoot_Click(object sender, RoutedEventArgs e)
    {
        if (ProjectFromSender(sender) is not { } project) return;
        if (!Directory.Exists(project.LocalRoot))
        {
            RecordActivity("project_root", $"local workspace missing for {project.Name}", false);
            return;
        }
        Process.Start(new ProcessStartInfo(project.LocalRoot) { UseShellExecute = true });
    }

    private void OpenProjectGitHub_Click(object sender, RoutedEventArgs e)
    {
        if (ProjectFromSender(sender) is { } project) OpenExternal(project.GitHubUrl, "github.com", "www.github.com");
    }

    private void OpenProjectDrive_Click(object sender, RoutedEventArgs e)
    {
        if (ProjectFromSender(sender) is { } project) OpenExternal(project.DriveUrl, "drive.google.com", "docs.google.com");
    }

    private ProjectWorkspace? ProjectFromSender(object sender) => (sender as FrameworkElement)?.DataContext as ProjectWorkspace;

    private void SaveProjects() => _projectStore.Save(Projects);

    private void OpenExternal(string? rawUrl, params string[] allowedHosts)
    {
        if (!Uri.TryCreate(rawUrl, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps ||
            !allowedHosts.Any(host => string.Equals(host, uri.Host, StringComparison.OrdinalIgnoreCase)))
        {
            RecordActivity("open_link", $"refused invalid or unexpected URL: {rawUrl}", false);
            return;
        }
        Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
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

    private void UpdateBrowserCompanionStatus(string message, bool ready)
    {
        if (!Dispatcher.CheckAccess())
        {
            Dispatcher.Invoke(() => UpdateBrowserCompanionStatus(message, ready));
            return;
        }

        _browserCompanionReady = ready;
        BrowserCompanionStatusText.Text = message;
        RefreshStatus();
    }

    private void RefreshStatus()
    {
        var locked = _settings.EmergencyLocked;
        HeaderStatusText.Text = locked ? "LOCKED" : (_chatReady || _browserCompanionReady) ? "CONSTELLATION READY" : "STARTING";
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
        _settings.AllowBrowserCompanion = BrowserCompanionCheck.IsChecked == true;
        _settings.AllowIdentity = IdentityCheck.IsChecked == true;
        _settings.AllowHostname = HostnameCheck.IsChecked == true;
        _settings.AllowIpConfig = IpConfigCheck.IsChecked == true;
        _settings.AllowSystemInfo = SystemInfoCheck.IsChecked == true;
        _store.SaveSettings(_settings);
        RecordActivity("policy", "Access policy saved; browser companion changes apply on next Project Constellation start", true);
        RefreshStatus();
    }

    private void SaveSettings_Click(object sender, RoutedEventArgs e)
    {
        _settings.AutoStart = AutoStartCheck.IsChecked == true;
        try
        {
            _store.SetAutoStart(_settings.AutoStart);
            _store.SaveSettings(_settings);
            RecordActivity("settings", _settings.AutoStart ? "Project Constellation Windows autostart enabled" : "Project Constellation Windows autostart disabled", true);
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
        RecordActivity("chatgpt_session", "Fresh ChatGPT conversation requested", true);
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

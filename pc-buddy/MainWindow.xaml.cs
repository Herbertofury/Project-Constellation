using PCBuddy.Core;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;

namespace PCBuddy;

public partial class MainWindow : Window
{
    private readonly PortableStore _store;
    private readonly SecretStore _secrets;
    private readonly AppSettings _settings;
    private readonly ToolBroker _tools;
    private readonly OpenAiBuddyClient _client;
    private CancellationTokenSource? _sendCts;
    private bool _apiValidated;

    public ObservableCollection<ChatMessage> Messages { get; } = new();
    public ObservableCollection<ActivityEntry> Activities { get; } = new();

    public MainWindow()
    {
        InitializeComponent();
        DataContext = this;
        _store = new PortableStore();
        _settings = _store.LoadSettings();
        _secrets = new SecretStore(_store.DataDirectory);
        _tools = new ToolBroker(() => _settings, RecordActivity);
        _client = new OpenAiBuddyClient(_tools, _settings.LastResponseId);
        _client.ConversationAdvanced += id =>
        {
            _settings.LastResponseId = id;
            _store.SaveSettings(_settings);
        };

        Messages.Add(new ChatMessage("assistant", "Hey — I’m PC Buddy. Once OpenAI is connected, ask me about this PC, your enabled folders, running apps, diagnostics, or anything else. Local access stays inside the policy you choose."));
        LoadSettingsIntoUi();
        SetPage("Home");
    }

    private async void Window_Loaded(object sender, RoutedEventArgs e)
    {
        PortableModeText.Text = _store.IsPortable ? "Portable data mode" : "Portable fallback mode";
        DataPathText.Text = _store.DataDirectory;
        var key = _secrets.LoadApiKey();
        if (string.IsNullOrWhiteSpace(key))
        {
            KeyNeededBanner.Visibility = Visibility.Visible;
            KeyStatusText.Text = "No API key detected.";
            _apiValidated = false;
        }
        else
        {
            KeyStatusText.Text = Environment.GetEnvironmentVariable("OPENAI_API_KEY") is { Length: > 0 }
                ? "Using OPENAI_API_KEY from Windows."
                : "Encrypted API key is saved for this Windows account.";
            var result = await _client.ValidateKeyAsync(key);
            _apiValidated = result.Ok;
            KeyStatusText.Text = result.Message;
            KeyNeededBanner.Visibility = result.Ok ? Visibility.Collapsed : Visibility.Visible;
        }
        RefreshStatus();
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
        WebSearchCheck.IsChecked = _settings.WebSearchEnabled;
        AutoStartCheck.IsChecked = _settings.AutoStart;
        SelectCombo(ModelCombo, _settings.Model);
        SelectCombo(ReasoningCombo, _settings.ReasoningEffort);
        RefreshStatus();
    }

    private static void SelectCombo(ComboBox combo, string value)
    {
        foreach (var item in combo.Items.OfType<ComboBoxItem>())
        {
            if (string.Equals(item.Content?.ToString(), value, StringComparison.OrdinalIgnoreCase))
            {
                combo.SelectedItem = item;
                return;
            }
        }
        if (combo.Items.Count > 0) combo.SelectedIndex = 0;
    }

    private void Nav_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: string page }) SetPage(page);
    }

    private void NavSettings_Click(object sender, RoutedEventArgs e) => SetPage("Settings");
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
            "Chat" => ("Buddy Chat", "GPT-5.6 Sol with your approved local tools"),
            "Access" => ("Access", "Choose exactly what Buddy can inspect locally"),
            "Activity" => ("Activity", "Local tool calls and their observed outcomes"),
            "Settings" => ("Settings", "Connection, model, portable state, and startup"),
            _ => ("Home", "Local tools and GPT connection at a glance")
        };
        if (page == "Chat") ChatInput.Focus();
    }

    private void RefreshStatus()
    {
        var locked = _settings.EmergencyLocked;
        HeaderStatusText.Text = locked ? "LOCKED" : _apiValidated ? "BUDDY READY" : "LOCAL READY";
        StatusPill.Background = locked ? (System.Windows.Media.Brush)FindResource("CardBrush") : (System.Windows.Media.Brush)FindResource("AccentDarkBrush");
        HeaderStatusText.Foreground = locked ? (System.Windows.Media.Brush)FindResource("DangerBrush") : (System.Windows.Media.Brush)FindResource("AccentBrush");
        EmergencyButton.Content = locked ? "Unlock Local Tools" : "Emergency Lock";
        LocalToolsStatusText.Text = locked ? "Locked" : "Ready";
        OpenAiStatusText.Text = _apiValidated ? "GPT-5.6 ready" : "Needs API key";
        AccessStatusText.Text = locked ? "Emergency locked" : "Read-only guarded";
    }

    private async void SaveKey_Click(object sender, RoutedEventArgs e)
    {
        var key = ApiKeyBox.Password.Trim();
        if (string.IsNullOrWhiteSpace(key))
        {
            KeyStatusText.Text = "Paste an OpenAI API key first.";
            return;
        }
        KeyStatusText.Text = "Testing GPT-5.6 Sol…";
        var result = await _client.ValidateKeyAsync(key);
        if (result.Ok)
        {
            _secrets.SaveApiKey(key);
            ApiKeyBox.Clear();
            _apiValidated = true;
            KeyNeededBanner.Visibility = Visibility.Collapsed;
        }
        KeyStatusText.Text = result.Message;
        RefreshStatus();
    }

    private void ForgetKey_Click(object sender, RoutedEventArgs e)
    {
        _secrets.ForgetApiKey();
        _apiValidated = !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("OPENAI_API_KEY"));
        KeyStatusText.Text = _apiValidated ? "Saved key removed; Windows OPENAI_API_KEY is still available." : "Saved key removed.";
        KeyNeededBanner.Visibility = _apiValidated ? Visibility.Collapsed : Visibility.Visible;
        RefreshStatus();
    }

    private void OpenApiKeys_Click(object sender, RoutedEventArgs e) => OpenUrl("https://platform.openai.com/settings/organization/api-keys");
    private void OpenChatGptConnector_Click(object sender, RoutedEventArgs e) => OpenUrl("https://chatgpt.com/#settings/Connectors");
    private static void OpenUrl(string url) => Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });

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
        _settings.Model = (ModelCombo.SelectedItem as ComboBoxItem)?.Content?.ToString() ?? "gpt-5.6-sol";
        _settings.ReasoningEffort = (ReasoningCombo.SelectedItem as ComboBoxItem)?.Content?.ToString() ?? "medium";
        _settings.WebSearchEnabled = WebSearchCheck.IsChecked == true;
        _settings.AutoStart = AutoStartCheck.IsChecked == true;
        try { _store.SetAutoStart(_settings.AutoStart); }
        catch (Exception ex) { RecordActivity("autostart", ex.Message, false); }
        _store.SaveSettings(_settings);
        RecordActivity("settings", $"Model {_settings.Model}; reasoning {_settings.ReasoningEffort}", true);
    }

    private void OpenData_Click(object sender, RoutedEventArgs e) => _store.OpenDataFolder();

    private void EmergencyLock_Click(object sender, RoutedEventArgs e)
    {
        _settings.EmergencyLocked = !_settings.EmergencyLocked;
        if (_settings.EmergencyLocked) _sendCts?.Cancel();
        _store.SaveSettings(_settings);
        RecordActivity("emergency_lock", _settings.EmergencyLocked ? "Local tools locked" : "Local tools unlocked", true);
        RefreshStatus();
    }

    private async void Send_Click(object sender, RoutedEventArgs e) => await SendCurrentAsync();

    private async void ChatInput_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter && Keyboard.Modifiers != ModifierKeys.Shift)
        {
            e.Handled = true;
            await SendCurrentAsync();
        }
    }

    private async Task SendCurrentAsync()
    {
        if (_sendCts is not null) return;
        var text = ChatInput.Text.Trim();
        if (string.IsNullOrWhiteSpace(text)) return;
        var key = _secrets.LoadApiKey();
        if (string.IsNullOrWhiteSpace(key))
        {
            SetPage("Settings");
            KeyStatusText.Text = "Connect OpenAI once, then Buddy Chat is ready.";
            KeyNeededBanner.Visibility = Visibility.Visible;
            return;
        }

        ChatInput.Clear();
        AddMessage("user", text);
        _sendCts = new CancellationTokenSource();
        SendButton.IsEnabled = false;
        CancelButton.Visibility = Visibility.Visible;
        try
        {
            var answer = await _client.SendAsync(key, text, _settings, _sendCts.Token);
            _apiValidated = true;
            AddMessage("assistant", answer);
        }
        catch (OperationCanceledException)
        {
            AddMessage("assistant", "Stopped. No more local tool work will run for that request.");
        }
        catch (Exception ex)
        {
            AddMessage("assistant", $"I hit a connection/runtime error: {ex.Message}");
            RecordActivity("openai", ex.Message, false);
        }
        finally
        {
            _sendCts.Dispose();
            _sendCts = null;
            SendButton.IsEnabled = true;
            CancelButton.Visibility = Visibility.Collapsed;
            RefreshStatus();
        }
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => _sendCts?.Cancel();

    private void NewChat_Click(object sender, RoutedEventArgs e)
    {
        _client.ResetConversation();
        Messages.Clear();
        AddMessage("assistant", "New conversation started. Your local access policy is unchanged.");
    }

    private void AddMessage(string role, string text)
    {
        Messages.Add(new ChatMessage(role, text));
        Dispatcher.BeginInvoke(() => ChatList.ScrollIntoView(Messages[^1]));
    }

    private void RecordActivity(string tool, string detail, bool ok)
    {
        Dispatcher.Invoke(() =>
        {
            var entry = new ActivityEntry(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"), tool, (ok ? "✓ " : "✕ ") + detail);
            Activities.Insert(0, entry);
            while (Activities.Count > 250) Activities.RemoveAt(Activities.Count - 1);
            _store.AppendActivity(new { time = DateTimeOffset.Now, tool, detail, ok });
        });
    }
}

public sealed record ChatMessage(string Role, string Text);
public sealed record ActivityEntry(string Time, string Tool, string Detail);

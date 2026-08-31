using System;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;

namespace PCBuddy;

public partial class MainWindow
{
    private CheckBox? _workFileMutationsCheck;
    private CheckBox? _workDeveloperCommandsCheck;
    private bool _workAgentUiInstalled;

    protected override void OnContentRendered(EventArgs e)
    {
        base.OnContentRendered(e);
        if (_workAgentUiInstalled) return;
        _workAgentUiInstalled = true;

        VersionText.Text = "v0.5.0-work-agent";
        InstallWorkAgentAccessCard();
        RewriteReadOnlyCopy();
        RefreshWorkAgentStatus();

        EmergencyButton.AddHandler(Button.ClickEvent, new RoutedEventHandler((_, _) =>
            Dispatcher.BeginInvoke(RefreshWorkAgentStatus, DispatcherPriority.Background)));
    }

    private void InstallWorkAgentAccessCard()
    {
        var scroll = AccessPage.Children.OfType<ScrollViewer>().FirstOrDefault();
        if (scroll?.Content is not StackPanel panel) return;

        _workFileMutationsCheck = new CheckBox
        {
            Content = "Let Project Constellation create, edit, copy, move, rename, and trash files inside enabled/project workspaces",
            IsChecked = _settings.AllowFileMutations,
            Margin = new Thickness(0, 0, 0, 8)
        };
        _workDeveloperCommandsCheck = new CheckBox
        {
            Content = "Let Project Constellation run approved developer tools in linked project workspaces (Git, .NET, npm/pnpm/yarn, Cargo, Gradle/Maven, Java)",
            IsChecked = _settings.AllowDeveloperCommands
        };

        void Persist(object? _, RoutedEventArgs __)
        {
            if (_workFileMutationsCheck is null || _workDeveloperCommandsCheck is null) return;
            _settings.AllowFileMutations = _workFileMutationsCheck.IsChecked == true;
            _settings.AllowDeveloperCommands = _workDeveloperCommandsCheck.IsChecked == true;
            _store.SaveSettings(_settings);
            RecordActivity("work_agent_policy", $"file mutations={_settings.AllowFileMutations}; developer commands={_settings.AllowDeveloperCommands}", true);
            RefreshWorkAgentStatus();
        }

        _workFileMutationsCheck.Checked += Persist;
        _workFileMutationsCheck.Unchecked += Persist;
        _workDeveloperCommandsCheck.Checked += Persist;
        _workDeveloperCommandsCheck.Unchecked += Persist;

        var card = new Border
        {
            Background = (Brush)FindResource("CardBrush"),
            BorderBrush = (Brush)FindResource("BorderBrush"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(12),
            Padding = new Thickness(16),
            Margin = new Thickness(0, 10, 0, 18),
            Child = new StackPanel
            {
                Children =
                {
                    new TextBlock { Text = "Work agent", FontSize = 18, FontWeight = FontWeights.SemiBold, Margin = new Thickness(0,0,0,8) },
                    new TextBlock
                    {
                        Text = "These capabilities are confined to Desktop/Documents/Downloads you enable plus local roots linked from Project tabs. Emergency Lock still overrides everything. Developer tools run directly without cmd.exe or PowerShell shell parsing.",
                        Foreground = (Brush)FindResource("MutedBrush"),
                        TextWrapping = TextWrapping.Wrap,
                        FontSize = 11,
                        Margin = new Thickness(0,0,0,12)
                    },
                    _workFileMutationsCheck,
                    _workDeveloperCommandsCheck
                }
            }
        };

        panel.Children.Insert(Math.Min(2, panel.Children.Count), card);
    }

    private void RewriteReadOnlyCopy()
    {
        foreach (var text in Descendants<TextBlock>(AccessPage))
        {
            if (text.Text.Contains("can only read files", StringComparison.OrdinalIgnoreCase))
                text.Text = "Project Constellation can inspect and, when Work agent is enabled, modify files only inside folders you enable or link as project workspaces.";
        }
    }

    private void RefreshWorkAgentStatus()
    {
        if (_settings.EmergencyLocked)
        {
            AccessStatusText.Text = "Emergency locked";
            LocalToolsStatusText.Text = "Locked";
            return;
        }

        AccessStatusText.Text = _settings.AllowFileMutations
            ? (_settings.AllowDeveloperCommands ? "Read / write / code" : "Read / write")
            : "Read-only";
        LocalToolsStatusText.Text = _settings.AllowDeveloperCommands ? "Work agent ready" : "File tools ready";
    }

    private static System.Collections.Generic.IEnumerable<T> Descendants<T>(DependencyObject root) where T : DependencyObject
    {
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(root); i++)
        {
            var child = VisualTreeHelper.GetChild(root, i);
            if (child is T match) yield return match;
            foreach (var nested in Descendants<T>(child)) yield return nested;
        }
    }
}

using PCBuddy.Core;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Windows;
using System.Windows.Threading;

namespace PCBuddy;

public partial class App : Application
{
    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        if (e.Args.Any(arg => string.Equals(arg, "--self-test", StringComparison.OrdinalIgnoreCase)))
        {
            ShutdownMode = ShutdownMode.OnExplicitShutdown;
            var exitCode = await SelfTest.RunAsync();
            Environment.ExitCode = exitCode;
            Shutdown(exitCode);
            return;
        }

        if (e.Args.Any(arg => string.Equals(arg, "--bridge-dom-smoke", StringComparison.OrdinalIgnoreCase)))
        {
            ShutdownMode = ShutdownMode.OnExplicitShutdown;
            var exitCode = await BridgeDomSmoke.RunAsync();
            Environment.ExitCode = exitCode;
            Shutdown(exitCode);
            return;
        }

        if (e.Args.Any(arg => string.Equals(arg, "--ui-smoke", StringComparison.OrdinalIgnoreCase)))
        {
            RunUiSmoke();
            return;
        }

        var window = new MainWindow();
        MainWindow = window;
        window.Show();
    }

    private void RunUiSmoke()
    {
        ShutdownMode = ShutdownMode.OnExplicitShutdown;
        var receiptPath = Path.Combine(AppContext.BaseDirectory, "project-constellation-ui-smoke.json");
        MainWindow? window = null;
        DispatcherTimer? timeout = null;
        var finished = false;

        void Finish(bool passed, IReadOnlyDictionary<string, bool>? checks, string? failure)
        {
            if (finished) return;
            finished = true;
            timeout?.Stop();
            var receipt = new
            {
                app = "Project Constellation",
                version = "0.4.0-constellation",
                timestampUtc = DateTimeOffset.UtcNow,
                passed,
                failure,
                window = window is null ? null : new
                {
                    window.Title,
                    window.IsLoaded,
                    window.IsVisible,
                    window.ActualWidth,
                    window.ActualHeight
                },
                controls = checks
            };
            File.WriteAllText(receiptPath, JsonSerializer.Serialize(receipt, new JsonSerializerOptions { WriteIndented = true }));
            try { window?.Close(); } catch { }
            Environment.ExitCode = passed ? 0 : 1;
            Shutdown(passed ? 0 : 1);
        }

        try
        {
            window = new MainWindow(skipChatSession: true)
            {
                ShowInTaskbar = false,
                Opacity = 0.02,
                WindowStartupLocation = WindowStartupLocation.Manual,
                Left = -10000,
                Top = -10000
            };
            MainWindow = window;
            timeout = new DispatcherTimer { Interval = TimeSpan.FromSeconds(12) };
            timeout.Tick += (_, _) => Finish(false, null, "UI did not reach ContentRendered before timeout.");
            window.ContentRendered += (_, _) =>
            {
                var required = new[]
                {
                    "HomePage", "ProjectCountText", "ProjectsPage", "ProjectTabs", "AddProjectButton",
                    "ChatPage", "ChatHost", "ChatSessionStatusText", "ChatSessionHomeStatusText",
                    "BrowserCompanionStatusText", "AccessPage", "BrowserCompanionCheck", "ActivityPage",
                    "SettingsPage", "EmergencyButton", "ReloadChatButton", "NewBuddyChatButton",
                    "AutoStartCheck", "SessionProfilePathText"
                };
                var checks = required.ToDictionary(name => name, name => window.FindName(name) is not null, StringComparer.Ordinal);
                var passed = window.IsLoaded && window.ActualWidth > 0 && window.ActualHeight > 0 && checks.Values.All(value => value);
                Finish(passed, checks, passed ? null : "One or more required Project Constellation UI controls failed to instantiate.");
            };
            timeout.Start();
            window.Show();
        }
        catch (Exception ex)
        {
            Finish(false, null, ex.ToString());
        }
    }
}

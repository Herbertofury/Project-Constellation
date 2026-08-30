using PCBuddy.Core;
using System.Windows;

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

        var window = new MainWindow();
        MainWindow = window;
        window.Show();
    }
}

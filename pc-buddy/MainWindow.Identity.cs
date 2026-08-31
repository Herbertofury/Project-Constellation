using System;
using System.IO;
using System.Windows;

namespace PCBuddy;

public partial class MainWindow
{
    protected override void OnContentRendered(EventArgs e)
    {
        base.OnContentRendered(e);
        VersionText.Text = "v0.5.1-work-agent";
        if (!_settings.EmergencyLocked)
            AccessStatusText.Text = "Read/write/code guarded";

        var legacyReceipt = Path.Combine(AppContext.BaseDirectory, "project-constellation-legacy-migration.json");
        if (File.Exists(legacyReceipt))
            RecordActivity("legacy_migration", "Legacy PC Buddy runtime detected and disabled by Project Constellation", true);
    }
}

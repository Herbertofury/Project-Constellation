using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;

namespace PCBuddy.Core;

public sealed class ProjectWorkspaceStore
{
    private static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true
    };

    public string ProjectsPath { get; }

    public ProjectWorkspaceStore(string dataDirectory)
    {
        if (string.IsNullOrWhiteSpace(dataDirectory)) throw new ArgumentException("Data directory is required.", nameof(dataDirectory));
        Directory.CreateDirectory(dataDirectory);
        ProjectsPath = Path.Combine(dataDirectory, "projects.json");
    }

    public List<ProjectWorkspace> Load()
    {
        try
        {
            if (!File.Exists(ProjectsPath)) return new List<ProjectWorkspace>();
            var projects = JsonSerializer.Deserialize<List<ProjectWorkspace>>(File.ReadAllText(ProjectsPath, Encoding.UTF8), Json)
                           ?? new List<ProjectWorkspace>();
            return projects
                .Where(project => project is not null)
                .Select(Normalize)
                .OrderByDescending(project => project.UpdatedAtUtc)
                .ToList();
        }
        catch
        {
            TryBackupCorruptFile();
            return new List<ProjectWorkspace>();
        }
    }

    public void Save(IEnumerable<ProjectWorkspace> projects)
    {
        var normalized = projects
            .Where(project => project is not null)
            .Select(Normalize)
            .ToList();

        Directory.CreateDirectory(Path.GetDirectoryName(ProjectsPath)!);
        var temp = ProjectsPath + ".tmp";
        File.WriteAllText(temp, JsonSerializer.Serialize(normalized, Json), Encoding.UTF8);
        File.Move(temp, ProjectsPath, true);
    }

    private static ProjectWorkspace Normalize(ProjectWorkspace project)
    {
        if (string.IsNullOrWhiteSpace(project.Id)) project.Id = Guid.NewGuid().ToString("N");
        project.Name = string.IsNullOrWhiteSpace(project.Name) ? "Untitled Project" : project.Name.Trim();
        project.ChatUrl = project.ChatUrl?.Trim() ?? string.Empty;
        project.RelatedChatUrls ??= string.Empty;
        project.LocalRoot = project.LocalRoot?.Trim() ?? string.Empty;
        project.GitHubUrl = project.GitHubUrl?.Trim() ?? string.Empty;
        project.DriveUrl = project.DriveUrl?.Trim() ?? string.Empty;
        project.Checkpoint ??= string.Empty;
        project.Blocker ??= string.Empty;
        project.NextAction ??= string.Empty;
        project.Notes ??= string.Empty;
        if (project.UpdatedAtUtc == default) project.UpdatedAtUtc = DateTimeOffset.UtcNow;
        return project;
    }

    private void TryBackupCorruptFile()
    {
        try
        {
            if (!File.Exists(ProjectsPath)) return;
            var backup = Path.Combine(
                Path.GetDirectoryName(ProjectsPath)!,
                $"projects.corrupt-{DateTime.UtcNow:yyyyMMdd-HHmmss}.json");
            File.Copy(ProjectsPath, backup, overwrite: false);
        }
        catch { }
    }
}

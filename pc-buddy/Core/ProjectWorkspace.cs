using System;
using System.ComponentModel;
using System.Runtime.CompilerServices;

namespace PCBuddy.Core;

public sealed class ProjectWorkspace : INotifyPropertyChanged
{
    private string _id = Guid.NewGuid().ToString("N");
    private string _name = "New Project";
    private string _chatUrl = string.Empty;
    private string _relatedChatUrls = string.Empty;
    private string _localRoot = string.Empty;
    private string _gitHubUrl = string.Empty;
    private string _driveUrl = string.Empty;
    private string _checkpoint = string.Empty;
    private string _blocker = string.Empty;
    private string _nextAction = string.Empty;
    private string _notes = string.Empty;
    private DateTimeOffset _updatedAtUtc = DateTimeOffset.UtcNow;

    public string Id { get => _id; set => Set(ref _id, value); }
    public string Name { get => _name; set => Set(ref _name, value); }
    public string ChatUrl { get => _chatUrl; set => Set(ref _chatUrl, value); }
    public string RelatedChatUrls { get => _relatedChatUrls; set => Set(ref _relatedChatUrls, value); }
    public string LocalRoot { get => _localRoot; set => Set(ref _localRoot, value); }
    public string GitHubUrl { get => _gitHubUrl; set => Set(ref _gitHubUrl, value); }
    public string DriveUrl { get => _driveUrl; set => Set(ref _driveUrl, value); }
    public string Checkpoint { get => _checkpoint; set => Set(ref _checkpoint, value); }
    public string Blocker { get => _blocker; set => Set(ref _blocker, value); }
    public string NextAction { get => _nextAction; set => Set(ref _nextAction, value); }
    public string Notes { get => _notes; set => Set(ref _notes, value); }
    public DateTimeOffset UpdatedAtUtc { get => _updatedAtUtc; set => Set(ref _updatedAtUtc, value); }

    public event PropertyChangedEventHandler? PropertyChanged;

    public void Touch() => UpdatedAtUtc = DateTimeOffset.UtcNow;

    private void Set<T>(ref T field, T value, [CallerMemberName] string? propertyName = null)
    {
        if (Equals(field, value)) return;
        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}

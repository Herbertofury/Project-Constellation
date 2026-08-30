using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace PCBuddy.Core;

public sealed class SecretStore
{
    private readonly string _path;
    public SecretStore(string dataDirectory) => _path = Path.Combine(dataDirectory, "openai.key.dpapi");

    public string? LoadApiKey()
    {
        var env = Environment.GetEnvironmentVariable("OPENAI_API_KEY");
        if (!string.IsNullOrWhiteSpace(env)) return env.Trim();
        if (!File.Exists(_path)) return null;
        try
        {
            var encrypted = File.ReadAllBytes(_path);
            var clear = Unprotect(encrypted);
            return Encoding.UTF8.GetString(clear).Trim();
        }
        catch { return null; }
    }

    public bool HasSavedKey => File.Exists(_path);

    public void SaveApiKey(string key)
    {
        if (string.IsNullOrWhiteSpace(key)) throw new ArgumentException("API key is empty.");
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        var encrypted = Protect(Encoding.UTF8.GetBytes(key.Trim()));
        File.WriteAllBytes(_path, encrypted);
    }

    public void ForgetApiKey()
    {
        if (File.Exists(_path)) File.Delete(_path);
    }

    private static byte[] Protect(byte[] input)
    {
        var inBlob = BlobFromBytes(input);
        try
        {
            if (!CryptProtectData(ref inBlob, "PC Buddy OpenAI API Key", IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 0, out var outBlob))
                throw new InvalidOperationException($"CryptProtectData failed: {Marshal.GetLastWin32Error()}");
            try { return BytesFromBlob(outBlob); }
            finally { LocalFree(outBlob.pbData); }
        }
        finally { Marshal.FreeHGlobal(inBlob.pbData); }
    }

    private static byte[] Unprotect(byte[] input)
    {
        var inBlob = BlobFromBytes(input);
        try
        {
            if (!CryptUnprotectData(ref inBlob, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 0, out var outBlob))
                throw new InvalidOperationException($"CryptUnprotectData failed: {Marshal.GetLastWin32Error()}");
            try { return BytesFromBlob(outBlob); }
            finally { LocalFree(outBlob.pbData); }
        }
        finally { Marshal.FreeHGlobal(inBlob.pbData); }
    }

    private static DATA_BLOB BlobFromBytes(byte[] bytes)
    {
        var blob = new DATA_BLOB { cbData = bytes.Length, pbData = Marshal.AllocHGlobal(bytes.Length) };
        Marshal.Copy(bytes, 0, blob.pbData, bytes.Length);
        return blob;
    }

    private static byte[] BytesFromBlob(DATA_BLOB blob)
    {
        var bytes = new byte[blob.cbData];
        Marshal.Copy(blob.pbData, bytes, 0, bytes.Length);
        return bytes;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DATA_BLOB { public int cbData; public IntPtr pbData; }

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CryptProtectData(ref DATA_BLOB pDataIn, string? szDataDescr, IntPtr pOptionalEntropy,
        IntPtr pvReserved, IntPtr pPromptStruct, int dwFlags, out DATA_BLOB pDataOut);

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CryptUnprotectData(ref DATA_BLOB pDataIn, IntPtr ppszDataDescr, IntPtr pOptionalEntropy,
        IntPtr pvReserved, IntPtr pPromptStruct, int dwFlags, out DATA_BLOB pDataOut);

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr hMem);
}

using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace StarTab.WindowsVolumeHost;

internal static class Program
{
    private const string HostName = "com.startab.windows_volume";
    private const string Version = "2.0.0";
    private static readonly object WriteLock = new();
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    [MTAThread]
    private static int Main(string[] args)
    {
        try
        {
            if (args.Any(a => a.Equals("--uninstall", StringComparison.OrdinalIgnoreCase)))
                return Installer.Uninstall(HostName);

            var installIndex = Array.FindIndex(args, a => a.Equals("--install", StringComparison.OrdinalIgnoreCase));
            if (installIndex >= 0)
            {
                string? extensionId = installIndex + 1 < args.Length ? args[installIndex + 1] : null;
                return Installer.Install(HostName, extensionId);
            }

            bool launchedByBrowser = args.Any(a => a.StartsWith("chrome-extension://", StringComparison.OrdinalIgnoreCase))
                || Console.IsInputRedirected;

            if (!launchedByBrowser)
                return Installer.InteractiveInstall(HostName);

            return RunNativeHost();
        }
        catch (Exception ex)
        {
            try { Console.Error.WriteLine($"StarTab Windows Volume fatal: {ex}"); } catch { }
            return 1;
        }
    }

    private static int RunNativeHost()
    {
        string deviceId = DeviceIdentity.GetOrCreate();
        string deviceName = Environment.MachineName;

        using var audio = new AudioController();
        audio.StateChanged += state => Send(new
        {
            type = "state",
            deviceId,
            deviceName,
            volume = state.Volume,
            muted = state.Muted,
            ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        });

        AudioState initial;
        try
        {
            audio.Initialize();
            initial = audio.GetState();
        }
        catch (Exception ex)
        {
            initial = new AudioState(0, false);
            Send(new { type = "error", code = "audio-init", message = ex.Message });
        }

        Send(new
        {
            type = "hello",
            protocol = 2,
            agentVersion = Version,
            deviceId,
            deviceName,
            platform = "windows",
            volume = initial.Volume,
            muted = initial.Muted,
            ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        });

        using Stream input = Console.OpenStandardInput();
        while (true)
        {
            JsonDocument? message;
            try
            {
                message = NativeMessaging.Read(input);
                if (message is null) break;
            }
            catch (EndOfStreamException)
            {
                break;
            }
            catch (Exception ex)
            {
                Send(new { type = "error", code = "bad-message", message = ex.Message });
                continue;
            }

            using (message)
            {
                HandleMessage(audio, deviceId, message.RootElement);
            }
        }

        return 0;
    }

    private static void HandleMessage(AudioController audio, string deviceId, JsonElement root)
    {
        string type = root.TryGetProperty("type", out var typeNode) ? typeNode.GetString() ?? "" : "";
        try
        {
            switch (type)
            {
                case "ping":
                    Send(new { type = "pong", ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() });
                    break;

                case "getState":
                    SendState(audio, deviceId);
                    break;

                case "setVolume":
                    if (!root.TryGetProperty("value", out var volumeNode) || !volumeNode.TryGetDouble(out var rawVolume))
                        throw new ArgumentException("value requerido");
                    audio.SetVolume((float)Math.Clamp(rawVolume, 0, 100));
                    SendState(audio, deviceId);
                    break;

                case "setMute":
                    if (!root.TryGetProperty("muted", out var muteNode) || (muteNode.ValueKind is not JsonValueKind.True and not JsonValueKind.False))
                        throw new ArgumentException("muted requerido");
                    audio.SetMute(muteNode.GetBoolean());
                    SendState(audio, deviceId);
                    break;

                case "toggleMute":
                    audio.ToggleMute();
                    SendState(audio, deviceId);
                    break;

                case "step":
                    if (!root.TryGetProperty("delta", out var deltaNode) || !deltaNode.TryGetDouble(out var rawDelta))
                        throw new ArgumentException("delta requerido");
                    audio.Step((float)Math.Clamp(rawDelta, -100, 100));
                    SendState(audio, deviceId);
                    break;

                default:
                    Send(new { type = "error", code = "unknown-command", message = $"Comando no reconocido: {type}" });
                    break;
            }
        }
        catch (Exception ex)
        {
            Send(new { type = "error", code = "command-failed", command = type, message = ex.Message });
        }
    }

    private static void SendState(AudioController audio, string deviceId)
    {
        var state = audio.GetState();
        Send(new
        {
            type = "state",
            deviceId,
            deviceName = Environment.MachineName,
            volume = state.Volume,
            muted = state.Muted,
            ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        });
    }

    private static void Send(object payload)
    {
        lock (WriteLock)
        {
            NativeMessaging.Write(Console.OpenStandardOutput(), payload, JsonOptions);
        }
    }
}

internal static class NativeMessaging
{
    private const int MaxMessageBytes = 1024 * 1024;

    public static JsonDocument? Read(Stream input)
    {
        Span<byte> lengthBytes = stackalloc byte[4];
        int first = input.ReadByte();
        if (first < 0) return null;
        lengthBytes[0] = (byte)first;
        ReadExactly(input, lengthBytes[1..]);

        uint length = BitConverter.ToUInt32(lengthBytes);
        if (length == 0 || length > MaxMessageBytes)
            throw new InvalidDataException($"Longitud de mensaje inválida: {length}");

        byte[] payload = new byte[(int)length];
        ReadExactly(input, payload);
        return JsonDocument.Parse(payload);
    }

    public static void Write(Stream output, object payload, JsonSerializerOptions options)
    {
        byte[] json = JsonSerializer.SerializeToUtf8Bytes(payload, options);
        if (json.Length > MaxMessageBytes)
            throw new InvalidDataException("Mensaje demasiado grande");

        Span<byte> lengthBytes = stackalloc byte[4];
        BitConverter.TryWriteBytes(lengthBytes, json.Length);
        output.Write(lengthBytes);
        output.Write(json);
        output.Flush();
    }

    private static void ReadExactly(Stream input, Span<byte> buffer)
    {
        int offset = 0;
        while (offset < buffer.Length)
        {
            int read = input.Read(buffer[offset..]);
            if (read <= 0) throw new EndOfStreamException();
            offset += read;
        }
    }

    private static void ReadExactly(Stream input, byte[] buffer)
        => ReadExactly(input, buffer.AsSpan());
}

internal readonly record struct AudioState(int Volume, bool Muted);

internal sealed class AudioController : IDisposable
{
    private const uint ClsCtxAll = 23;
    private readonly object sync = new();
    private readonly Guid eventContext = new("6B29FC40-CA47-1067-B31D-00DD010662DA");
    private IMMDeviceEnumerator? enumerator;
    private IMMDevice? device;
    private IAudioEndpointVolume? endpoint;
    private VolumeCallback? volumeCallback;
    private DeviceNotificationClient? deviceCallback;
    private bool disposed;

    public event Action<AudioState>? StateChanged;

    public void Initialize()
    {
        lock (sync)
        {
            ThrowIfDisposed();
            if (enumerator is null)
            {
                enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
                deviceCallback = new DeviceNotificationClient(() => ThreadPool.QueueUserWorkItem(_ => SafeRebind()));
                Marshal.ThrowExceptionForHR(enumerator.RegisterEndpointNotificationCallback(deviceCallback));
            }
            RebindLocked();
        }
    }

    public AudioState GetState()
    {
        lock (sync)
        {
            EnsureEndpointLocked();
            Marshal.ThrowExceptionForHR(endpoint!.GetMasterVolumeLevelScalar(out float scalar));
            Marshal.ThrowExceptionForHR(endpoint.GetMute(out bool muted));
            int volume = (int)Math.Round(Math.Clamp(scalar, 0f, 1f) * 100f, MidpointRounding.AwayFromZero);
            return new AudioState(volume, muted);
        }
    }

    public void SetVolume(float percent)
    {
        lock (sync)
        {
            EnsureEndpointLocked();
            float normalized = Math.Clamp(percent, 0f, 100f) / 100f;
            Guid context = eventContext;
            Marshal.ThrowExceptionForHR(endpoint!.SetMasterVolumeLevelScalar(normalized, ref context));
        }
    }

    public void SetMute(bool muted)
    {
        lock (sync)
        {
            EnsureEndpointLocked();
            Guid context = eventContext;
            Marshal.ThrowExceptionForHR(endpoint!.SetMute(muted, ref context));
        }
    }

    public void ToggleMute()
    {
        var state = GetState();
        SetMute(!state.Muted);
    }

    public void Step(float delta)
    {
        var state = GetState();
        SetVolume(Math.Clamp(state.Volume + delta, 0f, 100f));
    }

    private void EnsureEndpointLocked()
    {
        ThrowIfDisposed();
        if (endpoint is null)
            RebindLocked();
    }

    private void SafeRebind()
    {
        try
        {
            lock (sync)
            {
                if (disposed) return;
                RebindLocked();
            }
            StateChanged?.Invoke(GetState());
        }
        catch (Exception ex)
        {
            try { Console.Error.WriteLine($"StarTab audio rebind: {ex.Message}"); } catch { }
        }
    }

    private void RebindLocked()
    {
        ReleaseEndpointLocked();
        if (enumerator is null)
            throw new InvalidOperationException("Enumerador de audio no inicializado");

        Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(EDataFlow.Render, ERole.Multimedia, out var newDevice));
        Guid endpointIid = typeof(IAudioEndpointVolume).GUID;
        Marshal.ThrowExceptionForHR(newDevice.Activate(ref endpointIid, ClsCtxAll, IntPtr.Zero, out object endpointObject));

        device = newDevice;
        endpoint = (IAudioEndpointVolume)endpointObject;
        volumeCallback = new VolumeCallback(data =>
        {
            int volume = (int)Math.Round(Math.Clamp(data.MasterVolume, 0f, 1f) * 100f, MidpointRounding.AwayFromZero);
            StateChanged?.Invoke(new AudioState(volume, data.Muted));
        });
        Marshal.ThrowExceptionForHR(endpoint.RegisterControlChangeNotify(volumeCallback));
    }

    private void ReleaseEndpointLocked()
    {
        if (endpoint is not null && volumeCallback is not null)
        {
            try { endpoint.UnregisterControlChangeNotify(volumeCallback); } catch { }
        }
        volumeCallback = null;

        if (endpoint is not null)
        {
            try { if (Marshal.IsComObject(endpoint)) Marshal.ReleaseComObject(endpoint); } catch { }
            endpoint = null;
        }
        if (device is not null)
        {
            try { if (Marshal.IsComObject(device)) Marshal.ReleaseComObject(device); } catch { }
            device = null;
        }
    }

    private void ThrowIfDisposed()
    {
        if (disposed) throw new ObjectDisposedException(nameof(AudioController));
    }

    public void Dispose()
    {
        lock (sync)
        {
            if (disposed) return;
            disposed = true;
            ReleaseEndpointLocked();
            if (enumerator is not null && deviceCallback is not null)
            {
                try { enumerator.UnregisterEndpointNotificationCallback(deviceCallback); } catch { }
            }
            deviceCallback = null;
            if (enumerator is not null)
            {
                try { if (Marshal.IsComObject(enumerator)) Marshal.ReleaseComObject(enumerator); } catch { }
                enumerator = null;
            }
        }
    }
}

internal readonly record struct VolumeNotification(Guid EventContext, bool Muted, float MasterVolume, uint Channels);

[ComVisible(true)]
[Guid("657804FA-D6AD-4496-8A60-352752AF4F89")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioEndpointVolumeCallback
{
    [PreserveSig]
    int OnNotify(IntPtr notifyData);
}

[ComVisible(true)]
internal sealed class VolumeCallback : IAudioEndpointVolumeCallback
{
    private readonly Action<VolumeNotification> callback;
    public VolumeCallback(Action<VolumeNotification> callback) => this.callback = callback;

    public int OnNotify(IntPtr notifyData)
    {
        if (notifyData == IntPtr.Zero) return 0;
        try
        {
            var header = Marshal.PtrToStructure<AudioVolumeNotificationData>(notifyData);
            callback(new VolumeNotification(header.EventContext, header.Muted != 0, header.MasterVolume, header.Channels));
        }
        catch { }
        return 0;
    }
}

[StructLayout(LayoutKind.Sequential)]
internal struct AudioVolumeNotificationData
{
    public Guid EventContext;
    public int Muted;
    public float MasterVolume;
    public uint Channels;
}

[ComVisible(true)]
[Guid("7991EEC9-7E89-4D85-8390-6C703CEC60C0")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMNotificationClient
{
    [PreserveSig] int OnDeviceStateChanged([MarshalAs(UnmanagedType.LPWStr)] string deviceId, uint newState);
    [PreserveSig] int OnDeviceAdded([MarshalAs(UnmanagedType.LPWStr)] string deviceId);
    [PreserveSig] int OnDeviceRemoved([MarshalAs(UnmanagedType.LPWStr)] string deviceId);
    [PreserveSig] int OnDefaultDeviceChanged(EDataFlow flow, ERole role, [MarshalAs(UnmanagedType.LPWStr)] string? defaultDeviceId);
    [PreserveSig] int OnPropertyValueChanged([MarshalAs(UnmanagedType.LPWStr)] string deviceId, PropertyKey key);
}

[ComVisible(true)]
internal sealed class DeviceNotificationClient : IMMNotificationClient
{
    private readonly Action defaultDeviceChanged;
    public DeviceNotificationClient(Action callback) => defaultDeviceChanged = callback;

    public int OnDeviceStateChanged(string deviceId, uint newState) => 0;
    public int OnDeviceAdded(string deviceId) => 0;
    public int OnDeviceRemoved(string deviceId) => 0;
    public int OnPropertyValueChanged(string deviceId, PropertyKey key) => 0;

    public int OnDefaultDeviceChanged(EDataFlow flow, ERole role, string? defaultDeviceId)
    {
        if (flow == EDataFlow.Render && (role == ERole.Multimedia || role == ERole.Console))
            defaultDeviceChanged();
        return 0;
    }
}

[StructLayout(LayoutKind.Sequential)]
internal struct PropertyKey
{
    public Guid FormatId;
    public uint PropertyId;
}

internal enum EDataFlow
{
    Render = 0,
    Capture = 1,
    All = 2
}

internal enum ERole
{
    Console = 0,
    Multimedia = 1,
    Communications = 2
}

[ComImport]
[Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
internal class MMDeviceEnumeratorComObject { }

[ComImport]
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDeviceEnumerator
{
    [PreserveSig] int EnumAudioEndpoints(EDataFlow dataFlow, uint stateMask, out IntPtr devices);
    [PreserveSig] int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice device);
    [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
    [PreserveSig] int RegisterEndpointNotificationCallback(IMMNotificationClient client);
    [PreserveSig] int UnregisterEndpointNotificationCallback(IMMNotificationClient client);
}

[ComImport]
[Guid("D666063F-1587-4E43-81F1-B948E807363F")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDevice
{
    [PreserveSig]
    int Activate(ref Guid iid, uint clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object interfaceObject);
}

[ComImport]
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioEndpointVolume
{
    [PreserveSig] int RegisterControlChangeNotify(IAudioEndpointVolumeCallback notify);
    [PreserveSig] int UnregisterControlChangeNotify(IAudioEndpointVolumeCallback notify);
    [PreserveSig] int GetChannelCount(out uint channelCount);
    [PreserveSig] int SetMasterVolumeLevel(float levelDb, ref Guid eventContext);
    [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid eventContext);
    [PreserveSig] int GetMasterVolumeLevel(out float levelDb);
    [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
    [PreserveSig] int SetChannelVolumeLevel(uint channel, float levelDb, ref Guid eventContext);
    [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid eventContext);
    [PreserveSig] int GetChannelVolumeLevel(uint channel, out float levelDb);
    [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid eventContext);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    [PreserveSig] int GetVolumeStepInfo(out uint stepIndex, out uint stepCount);
    [PreserveSig] int VolumeStepUp(ref Guid eventContext);
    [PreserveSig] int VolumeStepDown(ref Guid eventContext);
    [PreserveSig] int QueryHardwareSupport(out uint hardwareSupportMask);
    [PreserveSig] int GetVolumeRange(out float minDb, out float maxDb, out float incrementDb);
}

internal static class DeviceIdentity
{
    public static string GetOrCreate()
    {
        string folder = Installer.InstallDirectory;
        Directory.CreateDirectory(folder);
        string file = Path.Combine(folder, "device-id.txt");
        try
        {
            if (File.Exists(file))
            {
                string saved = File.ReadAllText(file).Trim();
                if (Guid.TryParse(saved, out var parsed)) return parsed.ToString("D");
            }
        }
        catch { }

        string created = Guid.NewGuid().ToString("D");
        try { File.WriteAllText(file, created, Encoding.UTF8); } catch { }
        return created;
    }
}

internal static class Installer
{
    internal static string InstallDirectory => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "StarTab",
        "WindowsVolume");

    public static int InteractiveInstall(string hostName)
    {
        Console.Title = "StarTab · Windows Volume";
        Console.WriteLine("StarTab Windows Volume Host");
        Console.WriteLine("--------------------------------");
        Console.WriteLine("Este programa NO usa Firebase. Solo conecta Windows con tu extensión StarTab.");
        Console.WriteLine();
        Console.WriteLine("1) Abre chrome://extensions");
        Console.WriteLine("2) Activa 'Modo de desarrollador'");
        Console.WriteLine("3) Copia el ID de la extensión StarTab (32 caracteres)");
        Console.WriteLine();
        Console.Write("Pega aquí el ID de StarTab: ");
        string? id = Console.ReadLine();
        return Install(hostName, id);
    }

    public static int Install(string hostName, string? extensionId)
    {
        extensionId = (extensionId ?? string.Empty).Trim().ToLowerInvariant();
        if (!Regex.IsMatch(extensionId, "^[a-p]{32}$"))
        {
            Console.Error.WriteLine("ID de extensión inválido. Debe tener 32 caracteres entre a y p.");
            Console.Error.WriteLine("Ejemplo de uso: StartabWindowsVolume.exe --install abcdefghijklmnopqrstuvwxyzabcdef");
            return 2;
        }

        Directory.CreateDirectory(InstallDirectory);
        string currentExe = Environment.ProcessPath ?? throw new InvalidOperationException("No se pudo localizar el ejecutable actual");
        string installedExe = Path.Combine(InstallDirectory, "StartabWindowsVolume.exe");

        if (!Path.GetFullPath(currentExe).Equals(Path.GetFullPath(installedExe), StringComparison.OrdinalIgnoreCase))
            File.Copy(currentExe, installedExe, overwrite: true);

        string manifestPath = Path.Combine(InstallDirectory, $"{hostName}.json");
        var manifest = new
        {
            name = hostName,
            description = "StarTab Windows master volume native host",
            path = installedExe,
            type = "stdio",
            allowed_origins = new[] { $"chrome-extension://{extensionId}/" }
        };
        File.WriteAllText(manifestPath, JsonSerializer.Serialize(manifest, new JsonSerializerOptions { WriteIndented = true }), Encoding.UTF8);

        RegisterHost($@"Software\Google\Chrome\NativeMessagingHosts\{hostName}", manifestPath);
        RegisterHost($@"Software\Microsoft\Edge\NativeMessagingHosts\{hostName}", manifestPath);

        Console.WriteLine();
        Console.WriteLine("✅ StarTab Windows Volume instalado correctamente.");
        Console.WriteLine($"Extensión autorizada: {extensionId}");
        Console.WriteLine($"Agente: {installedExe}");
        Console.WriteLine();
        Console.WriteLine("Recarga StarTab en chrome://extensions. Chrome iniciará el agente automáticamente.");
        return 0;
    }

    private static void RegisterHost(string registryPath, string manifestPath)
    {
        using RegistryKey key = Registry.CurrentUser.CreateSubKey(registryPath, writable: true)
            ?? throw new InvalidOperationException($"No se pudo crear {registryPath}");
        key.SetValue(null, manifestPath, RegistryValueKind.String);
    }

    public static int Uninstall(string hostName)
    {
        try { Registry.CurrentUser.DeleteSubKeyTree($@"Software\Google\Chrome\NativeMessagingHosts\{hostName}", false); } catch { }
        try { Registry.CurrentUser.DeleteSubKeyTree($@"Software\Microsoft\Edge\NativeMessagingHosts\{hostName}", false); } catch { }
        try { File.Delete(Path.Combine(InstallDirectory, $"{hostName}.json")); } catch { }
        try { File.Delete(Path.Combine(InstallDirectory, "device-id.txt")); } catch { }
        Console.WriteLine("StarTab Windows Volume fue desvinculado de Chrome/Edge.");
        return 0;
    }
}

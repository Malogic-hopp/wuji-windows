using System.IO;
using System.Linq;
using System.Text.Json;
using System.Xml.Linq;

namespace QuantifiedSelf.Windows.Tests;

[Trait("Category", "Fast")]
public sealed class TauriPackageLayoutArchitectureTests
{
    [Fact]
    public void PackageContract_FreezesDevPreviewIdentityVersionAndWinX64Target()
    {
        using var contract = JsonDocument.Parse(ReadRepositoryFile(
            "publish", "tauri", "package-layout.v1.json"));
        using var package = JsonDocument.Parse(ReadRepositoryFile(
            "src", "QuantifiedSelf.Windows.Tauri", "package.json"));
        using var tauri = JsonDocument.Parse(ReadRepositoryFile(
            "src", "QuantifiedSelf.Windows.Tauri", "src-tauri", "tauri.conf.json"));
        var directoryBuild = XDocument.Parse(ReadRepositoryFile("Directory.Build.props"));
        var root = contract.RootElement;

        Assert.Equal(1, root.GetProperty("schemaVersion").GetInt32());
        Assert.Equal("dev-preview", root.GetProperty("packageKind").GetString());
        Assert.Equal("dev", root.GetProperty("channel").GetString());
        Assert.Equal("Release", root.GetProperty("configuration").GetString());
        Assert.Equal("win-x64", root.GetProperty("runtimeIdentifier").GetString());
        Assert.Equal("x86_64-pc-windows-msvc", root.GetProperty("targetTriple").GetString());

        var version = root.GetProperty("version").GetString();
        Assert.Equal(package.RootElement.GetProperty("version").GetString(), version);
        Assert.Equal(tauri.RootElement.GetProperty("version").GetString(), version);
        Assert.Equal(directoryBuild.Descendants("Version").Single().Value, version);
        Assert.Equal("com.wuji.windows.dev", root.GetProperty("tauri").GetProperty("identifier").GetString());
        Assert.Equal("artifacts/tauri-dev-preview/0.1.0/win-x64", root.GetProperty("output").GetProperty("root").GetString());
    }

    [Fact]
    public void PackageContract_IsolatesBridgeAndAgentAndUsesTargetTripleBridgeName()
    {
        using var contract = JsonDocument.Parse(ReadRepositoryFile(
            "publish", "tauri", "package-layout.v1.json"));
        var layout = contract.RootElement.GetProperty("layout");
        var bridgeExecutable = layout.GetProperty("bridgeExecutable").GetString()!;
        var agentExecutable = layout.GetProperty("agentExecutable").GetString()!;

        Assert.Equal("bridge", layout.GetProperty("bridgeDirectory").GetString());
        Assert.Equal("bridge/Agent", layout.GetProperty("agentDirectory").GetString());
        Assert.Equal(
            "bridge/QuantifiedSelf.Windows.Client.Bridge-x86_64-pc-windows-msvc.exe",
            bridgeExecutable);
        Assert.Equal("bridge/Agent/QuantifiedSelf.Windows.Agent.exe", agentExecutable);
        Assert.DoesNotContain("QuantifiedSelf.Windows.App", bridgeExecutable, StringComparison.Ordinal);
        Assert.DoesNotContain("QuantifiedSelf.Windows.App", agentExecutable, StringComparison.Ordinal);
    }

    [Fact]
    public void IndependentPublishScript_PublishesBothDotNetProcessesSelfContainedWithoutWpf()
    {
        var publish = ReadRepositoryFile("publish", "scripts", "publish-tauri.ps1");

        Assert.Contains("QuantifiedSelf.Windows.Client.Bridge.csproj", publish, StringComparison.Ordinal);
        Assert.Contains("QuantifiedSelf.Windows.Agent.csproj", publish, StringComparison.Ordinal);
        Assert.Equal(2, publish.Split("'--self-contained', 'true'", StringSplitOptions.None).Length - 1);
        Assert.Contains("'tauri', 'build', '--no-bundle', '--target'", publish, StringComparison.Ordinal);
        Assert.Contains("Move-Item -LiteralPath $originalBridgeExecutable", publish, StringComparison.Ordinal);
        Assert.Contains("test-tauri-package-layout.ps1", publish, StringComparison.Ordinal);
        Assert.Contains("artifacts\\tauri-dev-preview", publish, StringComparison.Ordinal);
        Assert.DoesNotContain("QuantifiedSelf.Windows.App.csproj", publish, StringComparison.Ordinal);
        Assert.DoesNotContain("publish\\scripts\\publish.ps1", publish, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("--channel", publish, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("channel = 'prod'", publish, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void PackageLayoutGate_RequiresRuntimeIsolationHashesAndWpfExclusion()
    {
        var gate = ReadRepositoryFile("publish", "scripts", "test-tauri-package-layout.ps1");
        using var package = JsonDocument.Parse(ReadRepositoryFile(
            "src", "QuantifiedSelf.Windows.Tauri", "package.json"));
        var scripts = package.RootElement.GetProperty("scripts");

        Assert.Contains("coreclr.dll", gate, StringComparison.Ordinal);
        Assert.Contains("hostfxr.dll", gate, StringComparison.Ordinal);
        Assert.Contains("hostpolicy.dll", gate, StringComparison.Ordinal);
        Assert.Contains("System.Private.CoreLib.dll", gate, StringComparison.Ordinal);
        Assert.Contains("QuantifiedSelf.Windows.Client.Bridge.deps.json", gate, StringComparison.Ordinal);
        Assert.Contains("QuantifiedSelf.Windows.Agent.deps.json", gate, StringComparison.Ordinal);
        Assert.Contains("Get-FileHash -Algorithm SHA256", gate, StringComparison.Ordinal);
        Assert.Contains("QuantifiedSelf.Windows.App.exe", gate, StringComparison.Ordinal);
        Assert.Contains("Agent artifacts must remain isolated under bridge/Agent", gate, StringComparison.Ordinal);
        Assert.Contains("publish-tauri.ps1", scripts.GetProperty("package:dev-preview").GetString(), StringComparison.Ordinal);
        Assert.Contains("test-tauri-package-layout.ps1", scripts.GetProperty("package:layout:check").GetString(), StringComparison.Ordinal);
    }

    [Fact]
    public void ReleaseBridgePath_UsesTheCargoTargetTripleAndCannotBeSuppliedByReact()
    {
        var supervisor = ReadRepositoryFile(
            "src", "QuantifiedSelf.Windows.Tauri", "src-tauri", "src", "bridge", "supervisor.rs");
        var reactClient = ReadRepositoryFile(
            "src", "QuantifiedSelf.Windows.Tauri", "src", "bridge", "client.ts");

        Assert.Contains("env!(\"TAURI_ENV_TARGET_TRIPLE\")", supervisor, StringComparison.Ordinal);
        Assert.Contains("packaged_bridge_executable_name()", supervisor, StringComparison.Ordinal);
        Assert.Contains("QuantifiedSelf.Windows.Client.Bridge-{}.exe", supervisor, StringComparison.Ordinal);
        Assert.DoesNotContain("targetTriple", reactClient, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("bridgePath", reactClient, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ReleaseShell_UsesWindowsGuiSubsystemAndThePackageGateReadsThePeHeader()
    {
        var main = ReadRepositoryFile(
            "src", "QuantifiedSelf.Windows.Tauri", "src-tauri", "src", "main.rs");
        var gate = ReadRepositoryFile(
            "publish", "scripts", "test-tauri-package-layout.ps1");

        Assert.Contains(
            "#![cfg_attr(not(debug_assertions), windows_subsystem = \"windows\")]",
            main,
            StringComparison.Ordinal);
        Assert.Contains("function Get-PeSubsystem", gate, StringComparison.Ordinal);
        Assert.Contains("$optionalHeaderOffset + 68", gate, StringComparison.Ordinal);
        Assert.Contains("$shellSubsystem -ne 2", gate, StringComparison.Ordinal);
        Assert.Contains("Windows GUI subsystem 2", gate, StringComparison.Ordinal);
    }

    private static string ReadRepositoryFile(params string[] segments)
    {
        var path = segments.Aggregate(
            FindRepositoryRoot(),
            (current, segment) => Path.Combine(current, segment));
        return File.ReadAllText(path);
    }

    private static string FindRepositoryRoot()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            if (File.Exists(Path.Combine(current.FullName, "QuantifiedSelf.Windows.sln")))
                return current.FullName;
            current = current.Parent;
        }

        throw new DirectoryNotFoundException("Could not locate repository root.");
    }
}

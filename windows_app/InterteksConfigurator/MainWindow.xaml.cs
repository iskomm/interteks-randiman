using System;
using System.Diagnostics;
using System.IO;
using System.IO.Ports;
using System.Text;
using System.Threading.Tasks;
using System.Windows;
using Microsoft.Win32;

namespace InterteksConfigurator;

public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
        ApiBox.Text = "https://interteks-randiman-server.onrender.com/ingest";
        FqbnBox.Text = "esp32:esp32:esp32";
        SketchPathBox.Text = FindSketchPath() ?? "";
        RefreshPorts();
    }

    private void OnBrowseCli(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog
        {
            Filter = "arduino-cli|arduino-cli.exe;arduino-cli|All files|*.*"
        };
        if (dialog.ShowDialog() == true)
        {
            CliPathBox.Text = dialog.FileName;
        }
    }

    private void OnBrowseSketch(object sender, RoutedEventArgs e)
    {
        using var dialog = new System.Windows.Forms.FolderBrowserDialog();
        if (dialog.ShowDialog() == System.Windows.Forms.DialogResult.OK)
        {
            SketchPathBox.Text = dialog.SelectedPath;
        }
    }

    private void OnRefreshPorts(object sender, RoutedEventArgs e)
    {
        RefreshPorts();
    }

    private void RefreshPorts()
    {
        PortCombo.ItemsSource = SerialPort.GetPortNames();
        if (PortCombo.Items.Count > 0)
        {
            PortCombo.SelectedIndex = 0;
        }
    }

    private async void OnProgram(object sender, RoutedEventArgs e)
    {
        StatusText.Text = "";
        LogBox.Clear();

        var ssid = SsidBox.Text.Trim();
        var pass = PassBox.Password.Trim();
        var tezgahId = TezgahBox.Text.Trim();
        var apiUrl = ApiBox.Text.Trim();
        var cliPath = CliPathBox.Text.Trim();
        var sketchPath = SketchPathBox.Text.Trim();
        var fqbn = FqbnBox.Text.Trim();
        var port = PortCombo.SelectedItem?.ToString() ?? "";

        if (string.IsNullOrWhiteSpace(ssid) ||
            string.IsNullOrWhiteSpace(pass) ||
            string.IsNullOrWhiteSpace(tezgahId) ||
            string.IsNullOrWhiteSpace(apiUrl))
        {
            StatusText.Text = "Wi-Fi, tezgah ID ve API URL gerekli.";
            return;
        }
        if (string.IsNullOrWhiteSpace(sketchPath) || !Directory.Exists(sketchPath))
        {
            StatusText.Text = "Sketch klasoru gecersiz.";
            return;
        }
        if (string.IsNullOrWhiteSpace(fqbn))
        {
            StatusText.Text = "Board FQBN gerekli.";
            return;
        }
        if (string.IsNullOrWhiteSpace(port))
        {
            StatusText.Text = "COM port secilmedi.";
            return;
        }

        try
        {
            WriteCredentials(sketchPath, ssid, pass, tezgahId, apiUrl);
            StatusText.Text = "Derleniyor...";

            var cli = string.IsNullOrWhiteSpace(cliPath) ? "arduino-cli" : cliPath;
            await RunProcess(cli, $"compile --fqbn {fqbn} \"{sketchPath}\"");

            StatusText.Text = "Yukleniyor...";
            await RunProcess(cli, $"upload -p {port} --fqbn {fqbn} \"{sketchPath}\"");

            StatusText.Text = "Tamamlandi.";
        }
        catch (Exception ex)
        {
            StatusText.Text = "Hata olustu.";
            AppendLog(ex.Message);
        }
    }

    private void WriteCredentials(string sketchPath, string ssid, string pass, string tezgahId, string apiUrl)
    {
        var content = new StringBuilder()
            .AppendLine("#pragma once")
            .AppendLine($"#define WIFI_SSID_VALUE \"{EscapeForC(ssid)}\"")
            .AppendLine($"#define WIFI_PASS_VALUE \"{EscapeForC(pass)}\"")
            .AppendLine($"#define API_URL_VALUE \"{EscapeForC(apiUrl)}\"")
            .AppendLine($"#define TEZGAH_ID_VALUE \"{EscapeForC(tezgahId)}\"")
            .ToString();

        var path = Path.Combine(sketchPath, "credentials.h");
        File.WriteAllText(path, content, Encoding.UTF8);
        AppendLog($"credentials.h yazildi: {path}");
    }

    private static string EscapeForC(string value)
    {
        return value.Replace("\\", "\\\\").Replace("\"", "\\\"");
    }

    private async Task RunProcess(string fileName, string args)
    {
        AppendLog($"> {fileName} {args}");
        var psi = new ProcessStartInfo
        {
            FileName = fileName,
            Arguments = args,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        using var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, e) => { if (!string.IsNullOrWhiteSpace(e.Data)) AppendLog(e.Data); };
        process.ErrorDataReceived += (_, e) => { if (!string.IsNullOrWhiteSpace(e.Data)) AppendLog(e.Data); };

        if (!process.Start())
        {
            throw new InvalidOperationException("Process baslatilamadi.");
        }
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        await process.WaitForExitAsync();
        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException($"Komut hata kodu {process.ExitCode}");
        }
    }

    private void AppendLog(string message)
    {
        Dispatcher.Invoke(() =>
        {
            LogBox.AppendText(message + Environment.NewLine);
            LogBox.ScrollToEnd();
        });
    }

    private static string? FindSketchPath()
    {
        var dir = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
        for (var i = 0; i < 6 && dir != null; i++)
        {
            var candidate = Path.Combine(dir.FullName, "esp32_fw");
            if (File.Exists(Path.Combine(candidate, "esp32_fw.ino")))
            {
                return candidate;
            }
            dir = dir.Parent;
        }
        return null;
    }
}

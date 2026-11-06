// Kronikar.exe – starts the bundled Python with the app and exits. Built by installer/build.py with the
// .NET Framework compiler that ships with every Windows 10/11, so no extra tools are needed.
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Windows.Forms;

[assembly: AssemblyTitle("Kosmas")]
[assembly: AssemblyDescription("Kosmas – catalogue of game recordings")]
[assembly: AssemblyProduct("Kosmas")]
[assembly: AssemblyCompany("gingygames")]
[assembly: AssemblyCopyright("gingygames")]
[assembly: AssemblyVersion("@VERSION@.0")]
[assembly: AssemblyFileVersion("@VERSION@.0")]

static class Launcher
{
    static string Quote(string a)
    {
        if (a.Length > 0 && a.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return a;
        var sb = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in a)
        {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') sb.Append('\\', slashes * 2 + 1);
            else sb.Append('\\', slashes);
            slashes = 0;
            sb.Append(c);
        }
        sb.Append('\\', slashes * 2).Append('"');
        return sb.ToString();
    }

    [STAThread]
    static int Main(string[] args)
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string py = Path.Combine(dir, "python", "pythonw.exe");
        if (!File.Exists(py))
        {
            string lang = System.Globalization.CultureInfo.CurrentUICulture.TwoLetterISOLanguageName;
            bool cs = lang == "cs" || lang == "sk";
            MessageBox.Show(cs ? "Instalace Kosmase je poškozená (chybí " + py + ").\nNainstaluj aplikaci znovu."
                               : "The Kosmas installation is damaged (" + py + " is missing).\nPlease install the app again.",
                            "Kosmas", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        var sb = new StringBuilder("-m rpcatalog");
        foreach (string a in args) sb.Append(' ').Append(Quote(a));
        var psi = new ProcessStartInfo(py, sb.ToString());
        psi.WorkingDirectory = Path.Combine(dir, "app");
        psi.UseShellExecute = false;
        Process.Start(psi);
        return 0;
    }
}

using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Windows.Forms;

namespace RuankaoSingleExe
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string currentDir = AppDomain.CurrentDomain.BaseDirectory;
            string targetFolder = Path.Combine(currentDir, "RuankaoExam-Portable");
            if (!Directory.Exists(targetFolder))
            {
                string[] candidates = Directory.GetDirectories(currentDir, "RuankaoExam-Portable*");
                if (candidates.Length > 0) targetFolder = candidates[0];
            }
            string launcherExe = Path.Combine(targetFolder, "软件设计师刷题平台.exe");

            // If already extracted, launch directly
            if (File.Exists(launcherExe))
            {
                LaunchTarget(launcherExe, args);
                return;
            }

            // Extract embedded portable package
            Assembly assembly = Assembly.GetExecutingAssembly();
            string resourceName = null;

            foreach (string name in assembly.GetManifestResourceNames())
            {
                if (name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
                {
                    resourceName = name;
                    break;
                }
            }

            if (resourceName == null)
            {
                MessageBox.Show("错误: 未找到内置的便携包资源文件。", "软考刷题平台", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            string tempZip = Path.Combine(currentDir, "_temp_ruankao_setup.zip");

            try
            {
                using (Stream stream = assembly.GetManifestResourceStream(resourceName))
                using (FileStream fs = new FileStream(tempZip, FileMode.Create, FileAccess.Write))
                {
                    byte[] buffer = new byte[65536];
                    int bytesRead;
                    while ((bytesRead = stream.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        fs.Write(buffer, 0, bytesRead);
                    }
                }

                // Extract Zip to targetFolder
                if (!Directory.Exists(targetFolder))
                {
                    Directory.CreateDirectory(targetFolder);
                }

                ZipFile.ExtractToDirectory(tempZip, currentDir);
            }
            catch (Exception ex)
            {
                MessageBox.Show("解压安装便携包失败: " + ex.Message, "软考刷题平台", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            finally
            {
                if (File.Exists(tempZip))
                {
                    try { File.Delete(tempZip); } catch {}
                }
            }

            if (!File.Exists(launcherExe))
            {
                string[] candidates = Directory.GetDirectories(currentDir, "RuankaoExam-Portable*");
                foreach (string cand in candidates)
                {
                    string candidateExe = Path.Combine(cand, "软件设计师刷题平台.exe");
                    if (File.Exists(candidateExe))
                    {
                        launcherExe = candidateExe;
                        break;
                    }
                }
            }

            if (File.Exists(launcherExe))
            {
                LaunchTarget(launcherExe, args);
            }
            else
            {
                MessageBox.Show("解压完成，但未找到启动程序: " + launcherExe, "软考刷题平台", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        static void LaunchTarget(string exePath, string[] args)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = exePath,
                    Arguments = string.Join(" ", args),
                    WorkingDirectory = Path.GetDirectoryName(exePath),
                    UseShellExecute = true
                };
                Process.Start(psi);
            }
            catch (Exception ex)
            {
                MessageBox.Show("启动程序失败: " + ex.Message, "软考刷题平台", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }
}

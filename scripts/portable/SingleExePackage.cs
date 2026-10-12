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

            // Locate embedded portable zip package
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

            // Inspect the embedded zip to determine the target folder name
            string targetFolderName = null;
            try
            {
                using (Stream stream = assembly.GetManifestResourceStream(resourceName))
                using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Read))
                {
                    foreach (ZipArchiveEntry entry in archive.Entries)
                    {
                        string entryPath = entry.FullName.Replace('\\', '/');
                        int slashIndex = entryPath.IndexOf('/');
                        if (slashIndex > 0)
                        {
                            targetFolderName = entryPath.Substring(0, slashIndex);
                            break;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("读取内置便携包资源失败: " + ex.Message, "软考刷题平台", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            if (string.IsNullOrEmpty(targetFolderName))
            {
                targetFolderName = "RuankaoExam-Portable";
            }

            string targetFolder = Path.Combine(currentDir, targetFolderName);
            string launcherExe = Path.Combine(targetFolder, "软件设计师刷题平台.exe");

            // Case 1: If already extracted and launcher exists for this version, launch directly!
            if (File.Exists(launcherExe))
            {
                LaunchTarget(launcherExe, args);
                return;
            }

            // Case 2: Extraction needed (first launch, interrupted extraction, or upgrade)
            try
            {
                // Discover previous portable directory in the same directory for data migration
                string previousDataFolder = null;
                string[] existingDirs = Directory.GetDirectories(currentDir, "RuankaoExam-Portable*");
                foreach (string candidate in existingDirs)
                {
                    if (string.Equals(candidate, targetFolder, StringComparison.OrdinalIgnoreCase))
                        continue;
                    string candidateData = Path.Combine(candidate, "data");
                    string candidateDb = Path.Combine(candidateData, "app.db");
                    if (File.Exists(candidateDb))
                    {
                        previousDataFolder = candidateData;
                        break;
                    }
                }

                // Also check if standalone data directory exists next to exe
                string standaloneData = Path.Combine(currentDir, "data");
                if (previousDataFolder == null && File.Exists(Path.Combine(standaloneData, "app.db")))
                {
                    previousDataFolder = standaloneData;
                }

                // Extract embedded archive with overwrite capability (prevents "File already exists" error)
                using (Stream stream = assembly.GetManifestResourceStream(resourceName))
                using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Read))
                {
                    foreach (ZipArchiveEntry entry in archive.Entries)
                    {
                        string destinationPath = Path.Combine(currentDir, entry.FullName);
                        string destDir = Path.GetDirectoryName(destinationPath);
                        if (!string.IsNullOrEmpty(destDir) && !Directory.Exists(destDir))
                        {
                            Directory.CreateDirectory(destDir);
                        }

                        if (string.IsNullOrEmpty(entry.Name))
                        {
                            // Directory entry
                            continue;
                        }

                        // Extract file, overwriting existing files safely
                        entry.ExtractToFile(destinationPath, true);
                    }
                }

                // If previous user data was discovered, migrate it to the newly extracted targetFolder data dir
                string newDataDir = Path.Combine(targetFolder, "data");
                string newDbPath = Path.Combine(newDataDir, "app.db");
                if (!string.IsNullOrEmpty(previousDataFolder) && (!File.Exists(newDbPath) || new FileInfo(newDbPath).Length == 0))
                {
                    CopyDirectoryContent(previousDataFolder, newDataDir);
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("解压安装便携包失败: " + ex.Message, "软考刷题平台", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
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

        static void CopyDirectoryContent(string sourceDir, string targetDir)
        {
            if (!Directory.Exists(sourceDir)) return;
            if (!Directory.Exists(targetDir)) Directory.CreateDirectory(targetDir);

            foreach (string file in Directory.GetFiles(sourceDir))
            {
                string dest = Path.Combine(targetDir, Path.GetFileName(file));
                if (!File.Exists(dest))
                {
                    try { File.Copy(file, dest, false); } catch {}
                }
            }

            foreach (string dir in Directory.GetDirectories(sourceDir))
            {
                string subDest = Path.Combine(targetDir, Path.GetFileName(dir));
                CopyDirectoryContent(dir, subDest);
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

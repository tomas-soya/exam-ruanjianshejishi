using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;

namespace RuankaoSingleExe
{
    static class Program
    {
        static void ReportError(string message, bool isWarning = false)
        {
            if (string.Equals(Environment.GetEnvironmentVariable("RUANKAO_SINGLE_EXE_NO_GUI"), "1", StringComparison.OrdinalIgnoreCase))
            {
                Console.Error.WriteLine(message);
                Environment.Exit(1);
                return;
            }
            MessageBox.Show(
                message,
                "软考刷题平台",
                MessageBoxButtons.OK,
                isWarning ? MessageBoxIcon.Warning : MessageBoxIcon.Error
            );
        }

        static string ComputeStreamSha256(Stream stream)
        {
            using (SHA256 sha256 = SHA256.Create())
            {
                byte[] hash = sha256.ComputeHash(stream);
                StringBuilder sb = new StringBuilder(hash.Length * 2);
                foreach (byte b in hash)
                {
                    sb.Append(b.ToString("x2"));
                }
                return sb.ToString();
            }
        }

        static bool IsPackageUpToDate(Assembly assembly, string resourceName, string currentDir, string targetFolder, string launcherExe, string markerFile, string embeddedZipSha256)
        {
            if (!Directory.Exists(targetFolder) || !File.Exists(launcherExe) || !File.Exists(markerFile))
            {
                return false;
            }
            try
            {
                string recordedHash = File.ReadAllText(markerFile, Encoding.UTF8).Trim();
                if (!string.Equals(recordedHash, embeddedZipSha256, StringComparison.OrdinalIgnoreCase))
                {
                    return false;
                }

                using (Stream stream = assembly.GetManifestResourceStream(resourceName))
                using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Read))
                {
                    foreach (ZipArchiveEntry entry in archive.Entries)
                    {
                        if (string.IsNullOrEmpty(entry.Name)) continue;
                        string norm = entry.FullName.Replace('\\', '/');
                        int firstSlash = norm.IndexOf('/');
                        int lastSlash = norm.LastIndexOf('/');
                        // Verify all top-level files inside targetFolder (e.g., launcher exe, .package-meta.json, version.txt)
                        if (firstSlash > 0 && firstSlash == lastSlash)
                        {
                            string diskPath = Path.Combine(currentDir, entry.FullName);
                            if (!File.Exists(diskPath)) return false;
                            FileInfo fi = new FileInfo(diskPath);
                            if (fi.Length != entry.Length) return false;
                            using (Stream entryStream = entry.Open())
                            using (Stream fileStream = File.OpenRead(diskPath))
                            {
                                if (!string.Equals(ComputeStreamSha256(entryStream), ComputeStreamSha256(fileStream), StringComparison.OrdinalIgnoreCase))
                                {
                                    return false;
                                }
                            }
                        }
                    }
                }
                return true;
            }
            catch
            {
                return false;
            }
        }

        static string FindNewestPreviousDataFolder(string currentDir, string targetFolder)
        {
            string bestDataFolder = null;
            DateTime bestWriteTimeUtc = DateTime.MinValue;
            string bestDirName = string.Empty;

            string[] existingDirs = Directory.GetDirectories(currentDir, "RuankaoExam-Portable*");
            Array.Sort(existingDirs, StringComparer.OrdinalIgnoreCase);

            foreach (string candidate in existingDirs)
            {
                if (string.Equals(Path.GetFullPath(candidate), Path.GetFullPath(targetFolder), StringComparison.OrdinalIgnoreCase))
                    continue;
                string candidateData = Path.Combine(candidate, "data");
                string candidateDb = Path.Combine(candidateData, "app.db");
                if (File.Exists(candidateDb))
                {
                    FileInfo fi = new FileInfo(candidateDb);
                    if (fi.Length == 0) continue;
                    DateTime writeTime = fi.LastWriteTimeUtc;
                    string dirName = Path.GetFileName(candidate) ?? string.Empty;
                    if (bestDataFolder == null ||
                        writeTime > bestWriteTimeUtc ||
                        (writeTime == bestWriteTimeUtc && string.Compare(dirName, bestDirName, StringComparison.OrdinalIgnoreCase) > 0))
                    {
                        bestDataFolder = candidateData;
                        bestWriteTimeUtc = writeTime;
                        bestDirName = dirName;
                    }
                }
            }

            string standaloneData = Path.Combine(currentDir, "data");
            string standaloneDb = Path.Combine(standaloneData, "app.db");
            if (bestDataFolder == null && File.Exists(standaloneDb) && new FileInfo(standaloneDb).Length > 0)
            {
                bestDataFolder = standaloneData;
            }

            return bestDataFolder;
        }

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
                ReportError("错误: 未找到内置的便携包资源文件。");
                return;
            }

            // Inspect the embedded zip to determine the target folder name and SHA-256 digest
            string targetFolderName = null;
            string embeddedZipSha256 = null;
            try
            {
                using (Stream hashStream = assembly.GetManifestResourceStream(resourceName))
                {
                    embeddedZipSha256 = ComputeStreamSha256(hashStream);
                }

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
                ReportError("读取内置便携包资源失败: " + ex.Message);
                return;
            }

            if (string.IsNullOrEmpty(targetFolderName))
            {
                targetFolderName = "RuankaoExam-Portable";
            }

            string targetFolder = Path.Combine(currentDir, targetFolderName);
            string launcherExe = Path.Combine(targetFolder, "软件设计师刷题平台.exe");
            string markerFile = Path.Combine(targetFolder, ".package-sha256");

            // Case 1: Only skip extraction if both launcherExe, matching .package-sha256 marker, and top-level files match
            if (IsPackageUpToDate(assembly, resourceName, currentDir, targetFolder, launcherExe, markerFile, embeddedZipSha256))
            {
                if (File.Exists(launcherExe))
                {
                    LaunchTarget(launcherExe, args);
                    return;
                }
            }

            // Case 2: Extraction needed (first launch, interrupted extraction, or upgrade)
            try
            {
                if (File.Exists(markerFile))
                {
                    File.Delete(markerFile);
                }

                string previousDataFolder = FindNewestPreviousDataFolder(currentDir, targetFolder);

                string fullCurrentRoot = Path.GetFullPath(currentDir);
                if (!fullCurrentRoot.EndsWith(Path.DirectorySeparatorChar.ToString()))
                {
                    fullCurrentRoot += Path.DirectorySeparatorChar;
                }

                string dataPrefix = (targetFolderName + "/data/").Replace('\\', '/');

                // Extract embedded archive with overwrite capability (prevents "File already exists" error)
                using (Stream stream = assembly.GetManifestResourceStream(resourceName))
                using (ZipArchive archive = new ZipArchive(stream, ZipArchiveMode.Read))
                {
                    foreach (ZipArchiveEntry entry in archive.Entries)
                    {
                        string normalizedEntry = entry.FullName.Replace('\\', '/');
                        string destinationPath = Path.GetFullPath(Path.Combine(currentDir, entry.FullName));
                        if (!destinationPath.StartsWith(fullCurrentRoot, StringComparison.OrdinalIgnoreCase))
                        {
                            throw new InvalidOperationException("非法压缩包条目路径: " + entry.FullName);
                        }

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

                        // Preserve existing user data files during in-place upgrade
                        if (normalizedEntry.StartsWith(dataPrefix, StringComparison.OrdinalIgnoreCase) && File.Exists(destinationPath))
                        {
                            continue;
                        }

                        // Extract file, overwriting existing application files safely
                        entry.ExtractToFile(destinationPath, true);
                    }
                }

                // If previous user data was discovered, migrate it to the newly extracted targetFolder data dir
                string newDataDir = Path.Combine(targetFolder, "data");
                string newDbPath = Path.Combine(newDataDir, "app.db");
                if (!string.IsNullOrEmpty(previousDataFolder) && (!File.Exists(newDbPath) || new FileInfo(newDbPath).Length == 0))
                {
                    MigrateDataFolder(previousDataFolder, targetFolder, newDataDir, newDbPath);
                }

                // Write completion marker ONLY after full extraction and data migration succeed
                File.WriteAllText(markerFile, embeddedZipSha256 + Environment.NewLine, Encoding.UTF8);
            }
            catch (Exception ex)
            {
                ReportError("解压安装便携包失败: " + ex.Message);
                return;
            }

            if (File.Exists(launcherExe))
            {
                LaunchTarget(launcherExe, args);
            }
            else
            {
                ReportError("解压完成，但未找到启动程序: " + launcherExe, true);
            }
        }

        static void MigrateDataFolder(string previousDataFolder, string targetFolder, string newDataDir, string newDbPath)
        {
            if (!Directory.Exists(newDataDir))
            {
                Directory.CreateDirectory(newDataDir);
            }

            string prevDbPath = Path.Combine(previousDataFolder, "app.db");
            string nodeExe = Path.Combine(targetFolder, "bin", "node.exe");

            if (File.Exists(prevDbPath) && File.Exists(nodeExe))
            {
                string tempDbPath = newDbPath + ".migrating.tmp";
                if (File.Exists(tempDbPath)) File.Delete(tempDbPath);

                string script = "const {DatabaseSync}=require('node:sqlite');" +
                                "const src=new DatabaseSync(process.argv[1]);" +
                                "src.exec('PRAGMA busy_timeout = 3000;');" +
                                "src.prepare('VACUUM INTO ?').run(process.argv[2]);" +
                                "src.close();";
                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = nodeExe,
                    Arguments = "-e \"" + script + "\" \"" + prevDbPath + "\" \"" + tempDbPath + "\"",
                    WorkingDirectory = targetFolder,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                using (Process proc = Process.Start(psi))
                {
                    proc.WaitForExit(15000);
                    if (proc.ExitCode != 0 || !File.Exists(tempDbPath) || new FileInfo(tempDbPath).Length == 0)
                    {
                        throw new IOException("通过 SQLite VACUUM INTO 迁移历史学习数据库失败 (ExitCode=" + proc.ExitCode + ")");
                    }
                }
                if (File.Exists(newDbPath)) File.Delete(newDbPath);
                File.Move(tempDbPath, newDbPath);
            }

            CopyDirectoryContent(previousDataFolder, newDataDir);
        }

        static void CopyDirectoryContent(string sourceDir, string targetDir)
        {
            if (!Directory.Exists(sourceDir)) return;
            if (!Directory.Exists(targetDir)) Directory.CreateDirectory(targetDir);

            foreach (string file in Directory.GetFiles(sourceDir))
            {
                string fileName = Path.GetFileName(file);
                if (string.Equals(fileName, "app.db-wal", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(fileName, "app.db-shm", StringComparison.OrdinalIgnoreCase))
                {
                    // If app.db was already migrated via VACUUM INTO, skip raw WAL/SHM sidecars;
                    // otherwise copy them alongside raw app.db.
                    string mainDbDest = Path.Combine(targetDir, "app.db");
                    if (File.Exists(mainDbDest) && !File.Exists(Path.Combine(targetDir, ".raw-db-copied")))
                    {
                        continue;
                    }
                }

                string dest = Path.Combine(targetDir, fileName);
                if (!File.Exists(dest))
                {
                    File.Copy(file, dest, false);
                    if (string.Equals(fileName, "app.db", StringComparison.OrdinalIgnoreCase))
                    {
                        File.WriteAllText(Path.Combine(targetDir, ".raw-db-copied"), "1", Encoding.UTF8);
                    }
                }
            }

            string rawMarker = Path.Combine(targetDir, ".raw-db-copied");
            if (File.Exists(rawMarker))
            {
                try { File.Delete(rawMarker); } catch {}
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
                ReportError("启动程序失败: " + ex.Message);
            }
        }
    }
}

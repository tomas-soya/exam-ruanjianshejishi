using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace RuankaoExam
{
    class Program
    {
        [DllImport("Kernel32")]
        private static extern bool SetConsoleCtrlHandler(EventHandler handler, bool add);
        private delegate bool EventHandler(CtrlType sig);
        private static EventHandler _handler;

        private enum CtrlType
        {
            CTRL_C_EVENT = 0,
            CTRL_BREAK_EVENT = 1,
            CTRL_CLOSE_EVENT = 2,
            CTRL_LOGOFF_EVENT = 5,
            CTRL_SHUTDOWN_EVENT = 6
        }

        private static Process _nodeProcess;
        private static int _port = 3124;
        private static string _baseDir;

        static int Main(string[] args)
        {
            Console.OutputEncoding = Encoding.UTF8;
            _baseDir = AppDomain.CurrentDomain.BaseDirectory;

            // Parse custom port if provided
            int customPort = 0;
            if (args.Length > 0 && int.TryParse(args[0], out customPort))
            {
                _port = customPort;
            }

            Console.Title = "软考软件设计师备考工作台 - 本地服务守护中";
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine("======================================================================");
            Console.WriteLine("  [Ruankao Exam Platform] 软考本地刷题与备考工作台 (便携免安装版)");
            Console.WriteLine("======================================================================");
            Console.ResetColor();

            string nodeExe = Path.Combine(_baseDir, "bin", "node.exe");
            string appJs = Path.Combine(_baseDir, "bin", "app-unified.js");

            // Fallback for workspace testing layout
            if (!File.Exists(nodeExe))
            {
                string sysNode = Environment.GetEnvironmentVariable("PATH");
                // Check if node is in PATH
                nodeExe = "node.exe";
            }

            if (!File.Exists(appJs))
            {
                // Fallback check in apps/exam-service/src/unified-server.js
                string devAppJs = Path.Combine(_baseDir, "apps", "exam-service", "src", "unified-server.js");
                if (File.Exists(devAppJs))
                {
                    appJs = devAppJs;
                }
                else
                {
                    Console.ForegroundColor = ConsoleColor.Red;
                    Console.WriteLine("[错误] 找不到服务核心入口文件: " + appJs);
                    Console.ResetColor();
                    Console.WriteLine("请确保便携包文件完整。按任意键退出...");
                    Console.ReadKey();
                    return 1;
                }
            }

            // Print Network Access Info
            PrintNetworkInfo();

            // Register console exit handler
            _handler += new EventHandler(OnConsoleExit);
            SetConsoleCtrlHandler(_handler, true);

            // Start Node process
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = nodeExe,
                    Arguments = string.Format("\"{0}\"", appJs),
                    WorkingDirectory = _baseDir,
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true
                };

                psi.EnvironmentVariables["PORT"] = _port.ToString();
                psi.EnvironmentVariables["HOST"] = Environment.GetEnvironmentVariable("HOST") ?? "127.0.0.1";

                _nodeProcess = new Process { StartInfo = psi };
                _nodeProcess.OutputDataReceived += (s, e) => {
                    if (!string.IsNullOrEmpty(e.Data)) Console.WriteLine("[Service] " + e.Data);
                };
                _nodeProcess.ErrorDataReceived += (s, e) => {
                    if (!string.IsNullOrEmpty(e.Data)) Console.WriteLine("[Error] " + e.Data);
                };

                _nodeProcess.Start();
                _nodeProcess.BeginOutputReadLine();
                _nodeProcess.BeginErrorReadLine();

                Console.ForegroundColor = ConsoleColor.Green;
                Console.WriteLine("[提示] 服务核心已成功启动 (PID: " + _nodeProcess.Id + ")");
                Console.ResetColor();
            }
            catch (Exception ex)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine("[启动异常] 无法启动后台服务: " + ex.Message);
                Console.ResetColor();
                Console.WriteLine("按任意键退出...");
                Console.ReadKey();
                return 1;
            }

            // Wait for service readiness and launch browser
            Console.Write("正在等待服务就绪");
            bool isReady = false;
            string localUrl = string.Format("http://127.0.0.1:{0}", _port);
            string healthUrl = string.Format("http://127.0.0.1:{0}/api/v1/health", _port);

            for (int i = 0; i < 30; i++)
            {
                Thread.Sleep(300);
                Console.Write(".");
                if (CheckHttpHealth(healthUrl))
                {
                    isReady = true;
                    break;
                }
            }
            Console.WriteLine();

            if (isReady)
            {
                Console.ForegroundColor = ConsoleColor.Green;
                Console.WriteLine("[就绪] 服务已准备就绪！正在打开默认浏览器...");
                Console.ResetColor();
                try
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = localUrl,
                        UseShellExecute = true
                    });
                }
                catch {}
            }
            else
            {
                Console.ForegroundColor = ConsoleColor.Yellow;
                Console.WriteLine("[警告] 服务响应超时，请手动打开浏览器访问: " + localUrl);
                Console.ResetColor();
            }

            Console.WriteLine();
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine("======================================================================");
            Console.WriteLine("  提示: 保持本窗口开启以维持服务运行。输入 'q' 并回车即可退出。");
            Console.WriteLine("======================================================================");
            Console.ResetColor();

            // Interactive loop or wait for exit
            while (!_nodeProcess.HasExited)
            {
                string input = Console.ReadLine();
                if (input != null && input.Trim().ToLower() == "q")
                {
                    break;
                }
            }

            StopService();
            return 0;
        }

        private static bool CheckHttpHealth(string url)
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
                req.Timeout = 1000;
                req.Proxy = null;
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                {
                    return resp.StatusCode == HttpStatusCode.OK;
                }
            }
            catch
            {
                return false;
            }
        }

        private static void PrintNetworkInfo()
        {
            Console.WriteLine("----------------------------------------------------------------------");
            Console.ForegroundColor = ConsoleColor.Green;
            Console.WriteLine(string.Format("  本机访问入口:     http://127.0.0.1:{0}", _port));

            try
            {
                foreach (NetworkInterface ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus != OperationalStatus.Up || ni.NetworkInterfaceType == NetworkInterfaceType.Loopback)
                        continue;

                    IPInterfaceProperties ipProps = ni.GetIPProperties();
                    foreach (UnicastIPAddressInformation addr in ipProps.UnicastAddresses)
                    {
                        if (addr.Address.AddressFamily == AddressFamily.InterNetwork)
                        {
                            Console.WriteLine(string.Format("  局域网平板/手机:  http://{0}:{1}  ({2})", addr.Address, _port, ni.Name));
                        }
                    }
                }
            }
            catch {}

            Console.ResetColor();
            Console.WriteLine("----------------------------------------------------------------------");
        }

        private static bool OnConsoleExit(CtrlType sig)
        {
            StopService();
            return true;
        }

        private static void StopService()
        {
            Console.WriteLine("\n[守护程序] 正在优雅关闭服务与释放数据库连接...");
            try
            {
                // Try shutdown endpoint
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(string.Format("http://127.0.0.1:{0}/api/v1/admin/shutdown", _port));
                req.Method = "POST";
                req.Timeout = 1500;
                req.Proxy = null;
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse()) {}
            }
            catch {}

            if (_nodeProcess != null && !_nodeProcess.HasExited)
            {
                try
                {
                    if (!_nodeProcess.WaitForExit(2000))
                    {
                        _nodeProcess.Kill();
                    }
                }
                catch {}
            }
            Console.WriteLine("[守护程序] 已安全退出。");
        }
    }
}

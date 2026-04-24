using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;

internal static class Program
{
    private const int HC_ACTION = 0;
    private const int WH_KEYBOARD_LL = 13;
    private const int WH_MOUSE_LL = 14;

    private const int WM_KEYDOWN = 0x0100;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_MOUSEMOVE = 0x0200;
    private const int WM_LBUTTONDOWN = 0x0201;
    private const int WM_RBUTTONDOWN = 0x0204;
    private const int WM_MBUTTONDOWN = 0x0207;
    private const int WM_MOUSEWHEEL = 0x020A;
    private const int WM_XBUTTONDOWN = 0x020B;
    private const int WM_MOUSEHWHEEL = 0x020E;

    private static readonly HookProc KeyboardHookCallbackDelegate = KeyboardHookCallback;
    private static readonly HookProc MouseHookCallbackDelegate = MouseHookCallback;

    private static IntPtr _keyboardHook = IntPtr.Zero;
    private static IntPtr _mouseHook = IntPtr.Zero;

    [STAThread]
    private static void Main()
    {
        try
        {
            _keyboardHook = InstallHook(WH_KEYBOARD_LL, KeyboardHookCallbackDelegate);
            _mouseHook = InstallHook(WH_MOUSE_LL, MouseHookCallbackDelegate);

            Application.ApplicationExit += (sender, eventArgs) => UninstallHooks();
            AppDomain.CurrentDomain.ProcessExit += (sender, eventArgs) => UninstallHooks();

            Application.Run();
        }
        catch (Exception error)
        {
            try
            {
                Console.Error.WriteLine(error);
                Console.Error.Flush();
            }
            catch
            {
                // Ignore secondary failures while reporting startup issues.
            }
        }
        finally
        {
            UninstallHooks();
        }
    }

    private static IntPtr InstallHook(int hookId, HookProc callback)
    {
        using (var currentProcess = Process.GetCurrentProcess())
        {
            using (var currentModule = currentProcess.MainModule)
            {
                var moduleName = currentModule == null ? null : currentModule.ModuleName;
                var moduleHandle = string.IsNullOrWhiteSpace(moduleName) ? IntPtr.Zero : GetModuleHandle(moduleName);
                var hookHandle = SetWindowsHookEx(hookId, callback, moduleHandle, 0);

                if (hookHandle == IntPtr.Zero)
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                }

                return hookHandle;
            }
        }
    }

    private static void UninstallHooks()
    {
        if (_keyboardHook != IntPtr.Zero)
        {
            UnhookWindowsHookEx(_keyboardHook);
            _keyboardHook = IntPtr.Zero;
        }

        if (_mouseHook != IntPtr.Zero)
        {
            UnhookWindowsHookEx(_mouseHook);
            _mouseHook = IntPtr.Zero;
        }
    }

    private static IntPtr KeyboardHookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode == HC_ACTION)
        {
            var message = unchecked((int)(long)wParam);
            if (message == WM_KEYDOWN || message == WM_SYSKEYDOWN)
            {
                Emit("keyboard");
            }
        }

        return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
    }

    private static IntPtr MouseHookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode == HC_ACTION)
        {
            var message = unchecked((int)(long)wParam);
            switch (message)
            {
                case WM_MOUSEMOVE:
                case WM_LBUTTONDOWN:
                case WM_RBUTTONDOWN:
                case WM_MBUTTONDOWN:
                case WM_MOUSEWHEEL:
                case WM_XBUTTONDOWN:
                case WM_MOUSEHWHEEL:
                    Emit("pointer");
                    break;
            }
        }

        return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
    }

    private static void Emit(string eventType)
    {
        try
        {
            Console.Out.WriteLine(eventType);
            Console.Out.Flush();
        }
        catch
        {
            // Ignore write failures during shutdown.
        }
    }

    private delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string lpModuleName);
}

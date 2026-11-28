use crate::{
    EMBEDDED_PAYLOAD, engine,
    payload::Payload,
    windows::{self as host, WindowsSystem, wide},
};
use std::{io, path::PathBuf, thread};
use windows::{
    Win32::{
        Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, WPARAM},
        Graphics::Gdi::*,
        System::LibraryLoader::GetModuleHandleW,
        UI::{Input::KeyboardAndMouse::EnableWindow, WindowsAndMessaging::*},
    },
    core::{PCWSTR, w},
};

const DONE: u32 = WM_APP + 41;
const INSTALL: usize = 101;
const FOLDER: usize = 102;
const CHROME: usize = 103;
const EDGE: usize = 104;
const OPERA: usize = 105;
const FIREFOX: usize = 106;
const COPY_CHROMIUM: usize = 107;
const COPY_FIREFOX: usize = 108;
const OWNER: usize = 109;
const DOCTOR: usize = 110;
const ROLLBACK: usize = 111;
const UNINSTALL: usize = 112;

struct App {
    root: HWND,
    status: HWND,
    buttons: Vec<HWND>,
    busy: bool,
    font: HFONT,
    title_font: HFONT,
    background: HBRUSH,
    panel: HBRUSH,
}
struct Completion {
    text: String,
}

fn text(hwnd: HWND) -> String {
    unsafe {
        let length = GetWindowTextLengthW(hwnd).clamp(0, 32767) as usize;
        let mut buffer = vec![0u16; length + 1];
        let count = GetWindowTextW(hwnd, &mut buffer);
        String::from_utf16_lossy(&buffer[..count.max(0) as usize])
    }
}
fn set(hwnd: HWND, value: &str) {
    unsafe {
        let _ = SetWindowTextW(hwnd, PCWSTR(wide(value).as_ptr()));
    }
}
fn options(app: &App) -> io::Result<engine::Options> {
    host::options(PathBuf::from(text(app.root).trim()))
}
fn busy(app: &mut App, value: bool) {
    app.busy = value;
    unsafe {
        let _ = EnableWindow(app.root, !value);
        for button in &app.buttons {
            let _ = EnableWindow(*button, !value);
        }
    }
}

fn run_job(hwnd: HWND, app: &mut App, job: usize) -> io::Result<()> {
    let options = options(app)?;
    if job == UNINSTALL && host::detached_uninstall(&options, false)? {
        unsafe {
            let _ = DestroyWindow(hwnd);
        }
        return Ok(());
    }
    busy(app, true);
    set(
        app.status,
        match job {
            INSTALL => "Installing verified files and registering the browser hub...",
            OWNER => "Opening Computer Tools and waiting for its owner window...",
            ROLLBACK => "Restoring the previous release...",
            UNINSTALL => {
                "Removing managed files and restoring registrations... Your data will be kept."
            }
            _ => "Checking installed files and browser hub diagnostics...",
        },
    );
    let handle = hwnd.0 as usize;
    thread::spawn(move || {
        let result = (|| -> io::Result<String> {
            if job == OWNER {
                host::launch_owner(&options)?;
                return Ok("COMPUTER TOOLS OPENED\r\n\r\nThe owner window contains local computer controls and session permission controls. Start a session and choose its grants there when you want an agent to use those tools.".to_owned());
            }
            if job == DOCTOR {
                return host::doctor(&options);
            }
            let mut system = WindowsSystem::new()?;
            let outcome = match job {
                INSTALL => {
                    engine::install(&options, &Payload::parse(EMBEDDED_PAYLOAD)?, &mut system)
                }
                ROLLBACK => engine::rollback(&options, &mut system),
                UNINSTALL => engine::uninstall(&options, &mut system),
                _ => Err(io::Error::other("Unknown setup action.")),
            }?;
            let title = match outcome.action.as_str() {
                "installed" => "INSTALLED — finish browser setup below",
                "repaired" => "REPAIRED — browser files and registrations restored",
                "rolled_back" => "PREVIOUS RELEASE RESTORED",
                "uninstalled" => "UNINSTALLED — your data was preserved",
                _ => "Complete",
            };
            Ok(format!("{title}\r\n\r\n{}", outcome.notes.join("\r\n\r\n")))
        })();
        let message = Box::new(Completion {
            text: result.unwrap_or_else(|e| format!("SETUP NEEDS ATTENTION\r\n\r\n{e}")),
        });
        let pointer = Box::into_raw(message);
        unsafe {
            if PostMessageW(
                Some(HWND(handle as *mut _)),
                DONE,
                WPARAM(0),
                LPARAM(pointer as isize),
            )
            .is_err()
            {
                drop(Box::from_raw(pointer));
            }
        }
    });
    Ok(())
}

fn action(hwnd: HWND, app: &mut App, id: usize) -> io::Result<()> {
    if app.busy {
        return Ok(());
    }
    match id {
        INSTALL | OWNER | DOCTOR | ROLLBACK | UNINSTALL => run_job(hwnd, app, id),
        FOLDER => host::open_folder(&options(app)?.root),
        COPY_CHROMIUM => {
            host::copy_path(&options(app)?.root.join("browsers/chromium"))?;
            set(
                app.status,
                "Chromium extension folder copied.\r\n\r\nOpen your browser above, enable Developer mode, choose Load unpacked, and paste this folder. Then open Agent Monitor and connect the browser hub. Repeat in each browser/profile you want to monitor.",
            );
            Ok(())
        }
        COPY_FIREFOX => {
            host::copy_path(&options(app)?.root.join("browsers/firefox/manifest.json"))?;
            set(
                app.status,
                "Firefox manifest path copied.\r\n\r\nIn about:debugging, choose This Firefox → Load Temporary Add-on, then paste this manifest path. Open Agent Monitor and connect the hub. This unsigned development sensor must be loaded again after Firefox restarts.",
            );
            Ok(())
        }
        CHROME | EDGE | OPERA | FIREFOX => {
            if engine::read_receipt(&options(app)?)?.is_none() {
                return Err(io::Error::other(
                    "Click Install / Repair first, then enable the browser sensors.",
                ));
            }
            let browser = match id {
                CHROME => "chrome",
                EDGE => "edge",
                OPERA => "opera_gx",
                _ => "firefox",
            };
            host::open_browser_setup(browser)?;
            action(
                hwnd,
                app,
                if id == FIREFOX {
                    COPY_FIREFOX
                } else {
                    COPY_CHROMIUM
                },
            )
        }
        _ => Ok(()),
    }
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    unsafe {
        if message == WM_NCCREATE {
            let create = &*(lparam.0 as *const CREATESTRUCTW);
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, create.lpCreateParams as isize);
        }
        let pointer = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut App;
        if pointer.is_null() {
            return DefWindowProcW(hwnd, message, wparam, lparam);
        }
        let app = &mut *pointer;
        match message {
            WM_COMMAND => {
                if wparam.0 >> 16 == 0
                    && let Err(problem) = action(hwnd, app, wparam.0 & 0xffff)
                {
                    set(app.status, &problem.to_string());
                }
                LRESULT(0)
            }
            DONE => {
                let completion = Box::from_raw(lparam.0 as *mut Completion);
                busy(app, false);
                set(app.status, &completion.text);
                LRESULT(0)
            }
            WM_CTLCOLORSTATIC | WM_CTLCOLOREDIT => {
                let dc = HDC(wparam.0 as *mut _);
                let panel =
                    HWND(lparam.0 as *mut _) == app.status || HWND(lparam.0 as *mut _) == app.root;
                SetTextColor(dc, COLORREF(0x00eee8e4));
                SetBkColor(
                    dc,
                    if panel {
                        COLORREF(0x00312a26)
                    } else {
                        COLORREF(0x00201916)
                    },
                );
                LRESULT(if panel {
                    app.panel.0 as isize
                } else {
                    app.background.0 as isize
                })
            }
            WM_CLOSE => {
                if app.busy {
                    set(
                        app.status,
                        "Setup is finishing a transaction. This window can close when the operation completes.",
                    );
                } else {
                    let _ = DestroyWindow(hwnd);
                }
                LRESULT(0)
            }
            WM_DESTROY => {
                PostQuitMessage(0);
                LRESULT(0)
            }
            _ => DefWindowProcW(hwnd, message, wparam, lparam),
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn control(
    parent: HWND,
    class: PCWSTR,
    label: &str,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    id: usize,
    extra: WINDOW_STYLE,
    font: HFONT,
) -> io::Result<HWND> {
    let instance = unsafe { GetModuleHandleW(None) }.map_err(host::error)?;
    let child = unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE(0),
            class,
            PCWSTR(wide(label).as_ptr()),
            WS_CHILD | WS_VISIBLE | extra,
            x,
            y,
            width,
            height,
            Some(parent),
            Some(HMENU(id as *mut _)),
            Some(HINSTANCE(instance.0)),
            None,
        )
    }
    .map_err(host::error)?;
    unsafe {
        SendMessageW(
            child,
            WM_SETFONT,
            Some(WPARAM(font.0 as usize)),
            Some(LPARAM(1)),
        );
    }
    Ok(child)
}

pub fn show(root: PathBuf) -> io::Result<()> {
    let instance = unsafe { GetModuleHandleW(None) }.map_err(host::error)?;
    let background = unsafe { CreateSolidBrush(COLORREF(0x00201916)) };
    let panel = unsafe { CreateSolidBrush(COLORREF(0x00312a26)) };
    let make_font = |height, weight| unsafe {
        CreateFontW(
            height,
            0,
            0,
            0,
            weight,
            0,
            0,
            0,
            DEFAULT_CHARSET,
            OUT_DEFAULT_PRECIS,
            CLIP_DEFAULT_PRECIS,
            CLEARTYPE_QUALITY,
            0,
            w!("Segoe UI"),
        )
    };
    let font = make_font(-17, 400);
    let title_font = make_font(-31, 600);
    let class = WNDCLASSW {
        lpfnWndProc: Some(window_proc),
        hInstance: HINSTANCE(instance.0),
        lpszClassName: w!("ProjectConstellationSetup"),
        hCursor: unsafe { LoadCursorW(None, IDC_ARROW) }.map_err(host::error)?,
        hIcon: unsafe {
            LoadIconW(
                Some(HINSTANCE(instance.0)),
                PCWSTR(std::ptr::dangling::<u16>()),
            )
            .or_else(|_| LoadIconW(None, IDI_APPLICATION))
        }
        .map_err(host::error)?,
        hbrBackground: background,
        ..Default::default()
    };
    if unsafe { RegisterClassW(&class) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let app = Box::new(App {
        root: HWND::default(),
        status: HWND::default(),
        buttons: Vec::new(),
        busy: false,
        font,
        title_font,
        background,
        panel,
    });
    let pointer = Box::into_raw(app);
    let hwnd = unsafe {
        CreateWindowExW(
            WS_EX_CONTROLPARENT,
            class.lpszClassName,
            w!("Project Constellation — Setup & Computer Tools"),
            WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            800,
            750,
            None,
            None,
            Some(HINSTANCE(instance.0)),
            Some(pointer.cast()),
        )
    }
    .map_err(host::error)?;
    let app = unsafe { &mut *pointer };
    control(
        hwnd,
        w!("STATIC"),
        "Project Constellation",
        24,
        20,
        730,
        42,
        0,
        WINDOW_STYLE(0),
        title_font,
    )?;
    let version = Payload::parse(EMBEDDED_PAYLOAD)
        .map(|p| p.manifest.version)
        .unwrap_or_else(|_| "developer build".to_owned());
    control(
        hwnd,
        w!("STATIC"),
        &format!("Windows setup  •  {version}  •  Installs for your account"),
        26,
        66,
        730,
        25,
        0,
        WINDOW_STYLE(0),
        font,
    )?;
    control(
        hwnd,
        w!("STATIC"),
        "Agent monitoring, shared alerts and local Computer Tools in one place.",
        26,
        95,
        730,
        25,
        0,
        WINDOW_STYLE(0),
        font,
    )?;
    control(
        hwnd,
        w!("STATIC"),
        "Installation folder",
        26,
        134,
        730,
        23,
        0,
        WINDOW_STYLE(0),
        font,
    )?;
    app.root = control(
        hwnd,
        w!("EDIT"),
        &root.to_string_lossy(),
        26,
        160,
        730,
        30,
        200,
        WS_BORDER | WS_TABSTOP | WINDOW_STYLE(ES_AUTOHSCROLL as u32),
        font,
    )?;
    for (id, label, x, width) in [
        (INSTALL, "Install / Repair", 26, 230),
        (FOLDER, "Open installed folder", 272, 230),
    ] {
        app.buttons.push(control(
            hwnd,
            w!("BUTTON"),
            label,
            x,
            204,
            width,
            38,
            id,
            WS_TABSTOP | WINDOW_STYLE(BS_PUSHBUTTON as u32),
            font,
        )?);
    }
    control(
        hwnd,
        w!("STATIC"),
        "Connect your browsers",
        26,
        263,
        730,
        28,
        0,
        WINDOW_STYLE(0),
        font,
    )?;
    control(
        hwnd,
        w!("STATIC"),
        "Choose a browser to open extension settings and copy its sensor path.\r\nEnable the sensor in each profile; browser confirmation completes the connection.",
        26,
        295,
        730,
        48,
        0,
        WINDOW_STYLE(0),
        font,
    )?;
    for (id, label, x) in [
        (CHROME, "Google Chrome", 26),
        (EDGE, "Microsoft Edge", 212),
        (OPERA, "Opera GX", 398),
        (FIREFOX, "Firefox", 584),
    ] {
        app.buttons.push(control(
            hwnd,
            w!("BUTTON"),
            label,
            x,
            354,
            172,
            36,
            id,
            WS_TABSTOP | WINDOW_STYLE(BS_PUSHBUTTON as u32),
            font,
        )?);
    }
    for (id, label, x, width) in [
        (COPY_CHROMIUM, "Copy Chromium folder", 26, 300),
        (COPY_FIREFOX, "Copy Firefox manifest", 342, 300),
    ] {
        app.buttons.push(control(
            hwnd,
            w!("BUTTON"),
            label,
            x,
            402,
            width,
            32,
            id,
            WS_TABSTOP | WINDOW_STYLE(BS_PUSHBUTTON as u32),
            font,
        )?);
    }
    for (id, label, x, width) in [
        (OWNER, "Computer Tools", 26, 180),
        (DOCTOR, "Check installation", 218, 180),
        (ROLLBACK, "Roll back", 410, 162),
        (UNINSTALL, "Uninstall", 584, 172),
    ] {
        app.buttons.push(control(
            hwnd,
            w!("BUTTON"),
            label,
            x,
            456,
            width,
            36,
            id,
            WS_TABSTOP | WINDOW_STYLE(BS_PUSHBUTTON as u32),
            font,
        )?);
    }
    app.status = control(
        hwnd,
        w!("EDIT"),
        "Ready. Click Install / Repair to prepare the hub, sensors and Computer Tools.\r\n\r\nThe hub runs only while browser sensors are connected and restarts when they call it. No Windows startup service is needed.\r\n\r\nAfter connecting a sensor, use Agent Monitor → Test alert to check sound on this computer.",
        26,
        510,
        730,
        154,
        201,
        WS_BORDER
            | WS_VSCROLL
            | WS_TABSTOP
            | WINDOW_STYLE((ES_MULTILINE | ES_AUTOVSCROLL | ES_READONLY) as u32),
        font,
    )?;
    control(
        hwnd,
        w!("STATIC"),
        "Firefox: temporary unsigned sensor; reload after restart. Updates keep your data.",
        26,
        678,
        730,
        25,
        0,
        WINDOW_STYLE(0),
        font,
    )?;
    if let Ok(Some(receipt)) = engine::read_receipt(&host::options(root)?) {
        set(
            app.status,
            &format!(
                "Installed version: {}\r\n\r\nChoose a browser to finish sensor setup, open Computer Tools, or check the installation. Install / Repair stages this setup's payload again and preserves your data. Roll back restores an earlier installed release.",
                receipt.version
            ),
        );
    }
    unsafe {
        let _ = ShowWindow(hwnd, SW_SHOWNORMAL);
        let mut message = MSG::default();
        loop {
            let result = GetMessageW(&mut message, None, 0, 0).0;
            if result <= 0 {
                break;
            }
            if !IsDialogMessageW(hwnd, &message).as_bool() {
                let _ = TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
        let app = Box::from_raw(pointer);
        let _ = DeleteObject(HGDIOBJ(app.font.0));
        let _ = DeleteObject(HGDIOBJ(app.title_font.0));
        let _ = DeleteObject(HGDIOBJ(app.background.0));
        let _ = DeleteObject(HGDIOBJ(app.panel.0));
    }
    Ok(())
}

pub fn message(value: &str, failure: bool) {
    unsafe {
        MessageBoxW(
            None,
            PCWSTR(wide(value).as_ptr()),
            w!("Project Constellation"),
            MB_OK
                | if failure {
                    MB_ICONERROR
                } else {
                    MB_ICONINFORMATION
                },
        );
    }
}

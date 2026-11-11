use tray_icon::menu::{Menu, MenuEvent, MenuItem};
use tray_icon::{Icon, TrayIconBuilder};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, GetMessageW, TranslateMessage, MSG,
};

pub fn spawn(dashboard_url: String) {
    std::thread::spawn(move || {
        let menu = Menu::new();
        let open_item = MenuItem::new("Open dashboard", true, None);
        let quit_item = MenuItem::new("Quit", true, None);
        if menu.append(&open_item).is_err() || menu.append(&quit_item).is_err() {
            return;
        }

        let tray = match TrayIconBuilder::new()
            .with_tooltip("LAN Host Manager")
            .with_menu(Box::new(menu))
            .with_icon(icon())
            .build()
        {
            Ok(tray) => tray,
            Err(_) => return,
        };

        unsafe {
            let mut msg: MSG = std::mem::zeroed();
            while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);

                while let Ok(event) = MenuEvent::receiver().try_recv() {
                    if event.id == *open_item.id() {
                        open_dashboard(&dashboard_url);
                    } else if event.id == *quit_item.id() {
                        std::process::exit(0);
                    }
                }
            }
        }

        drop(tray);
    });
}

fn open_dashboard(url: &str) {
    let _ = std::process::Command::new("cmd")
        .args(["/C", "start", "", url])
        .spawn();
}

fn icon() -> Icon {
    const SIZE: usize = 32;
    let mut rgba = vec![0u8; SIZE * SIZE * 4];

    for y in 0..SIZE {
        for x in 0..SIZE {
            let i = (y * SIZE + x) * 4;
            let inside = (2..30).contains(&x) && (2..30).contains(&y);
            if !inside {
                continue;
            }
            let bar = (12..20).contains(&y) && (8..24).contains(&x);
            let (r, g, b) = if bar {
                (255, 255, 255)
            } else {
                (0x25, 0x63, 0xeb)
            };
            rgba[i] = r;
            rgba[i + 1] = g;
            rgba[i + 2] = b;
            rgba[i + 3] = 255;
        }
    }

    Icon::from_rgba(rgba, SIZE as u32, SIZE as u32).expect("valid tray icon pixels")
}

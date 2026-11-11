use yew::prelude::*;

use crate::{api, types::Project};

#[derive(Properties, PartialEq)]
pub struct Props {
    pub project: Project,
    pub on_refresh: Callback<()>,
}

#[function_component(ProjectCard)]
pub fn project_card(props: &Props) -> Html {
    let project = &props.project;
    let on_refresh = props.on_refresh.clone();
    let logs = use_state(|| None::<String>);

    let status_class = match project.status.as_str() {
        "running" => "status-running",
        "stopped" => "status-stopped",
        "crashed" => "status-crashed",
        _ => "status-stopped",
    };

    let on_start = {
        let id = project.id.clone();
        let on_refresh = on_refresh.clone();
        Callback::from(move |_| {
            let id = id.clone();
            let on_refresh = on_refresh.clone();
            wasm_bindgen_futures::spawn_local(async move {
                let _ = api::start_project(&id).await;
                on_refresh.emit(());
            });
        })
    };

    let on_stop = {
        let id = project.id.clone();
        let on_refresh = on_refresh.clone();
        Callback::from(move |_| {
            let id = id.clone();
            let on_refresh = on_refresh.clone();
            wasm_bindgen_futures::spawn_local(async move {
                let _ = api::stop_project(&id).await;
                on_refresh.emit(());
            });
        })
    };

    let on_restart = {
        let id = project.id.clone();
        let on_refresh = on_refresh.clone();
        Callback::from(move |_| {
            let id = id.clone();
            let on_refresh = on_refresh.clone();
            wasm_bindgen_futures::spawn_local(async move {
                let _ = api::restart_project(&id).await;
                on_refresh.emit(());
            });
        })
    };

    let on_delete = {
        let id = project.id.clone();
        let name = project.name.clone();
        let on_refresh = on_refresh.clone();
        Callback::from(move |_| {
            let confirmed = web_sys::window()
                .and_then(|window| {
                    window
                        .confirm_with_message(&format!(
                            "Delete \"{}\"? Its files will be removed.",
                            name
                        ))
                        .ok()
                })
                .unwrap_or(false);
            if !confirmed {
                return;
            }

            let id = id.clone();
            let on_refresh = on_refresh.clone();
            wasm_bindgen_futures::spawn_local(async move {
                let _ = api::delete_project(&id).await;
                on_refresh.emit(());
            });
        })
    };

    let on_logs = {
        let id = project.id.clone();
        let logs = logs.clone();
        Callback::from(move |_| {
            let id = id.clone();
            let logs = logs.clone();
            wasm_bindgen_futures::spawn_local(async move {
                match api::fetch_logs(&id).await {
                    Ok(text) if text.is_empty() => {
                        logs.set(Some("(no log output yet)".to_string()))
                    }
                    Ok(text) => logs.set(Some(text)),
                    Err(message) => logs.set(Some(format!("Error: {}", message))),
                }
            });
        })
    };

    html! {
        <div class="project-card">
            <div class="project-header">
                <div class="project-name">{&project.name}</div>
                <span class={classes!("status-badge", status_class)}>{&project.status}</span>
            </div>
            <div class="project-info">
                <div>{format!("Type: {}", project.project_type)}</div>
                <div>{format!("Port: {}", project.port)}</div>
                if !project.lan_urls.is_empty() {
                    <div>
                        <a href={project.lan_urls[0].clone()} target="_blank">
                            {&project.lan_urls[0]}
                        </a>
                    </div>
                }
            </div>
            <div class="project-actions">
                if project.status == "stopped" || project.status == "crashed" {
                    <button class="btn-primary" onclick={on_start}>{"Start"}</button>
                }
                if project.status == "running" {
                    <button class="btn-secondary" onclick={on_stop}>{"Stop"}</button>
                    <button class="btn-secondary" onclick={on_restart}>{"Restart"}</button>
                }
                <button class="btn-secondary" onclick={on_logs}>{"Logs"}</button>
                <button class="btn-danger" onclick={on_delete}>{"Delete"}</button>
            </div>
            if let Some(text) = (*logs).clone() {
                <pre class="logs">{text}</pre>
            }
        </div>
    }
}

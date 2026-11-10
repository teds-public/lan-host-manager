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
            </div>
        </div>
    }
}

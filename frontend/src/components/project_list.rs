use yew::prelude::*;
use web_sys::HtmlInputElement;

use crate::{api, components::project_card::ProjectCard, types::Project};

#[function_component(ProjectList)]
pub fn project_list() -> Html {
    let projects = use_state(|| Vec::<Project>::new());
    let loading = use_state(|| true);
    let uploading = use_state(|| false);
    let selected_file = use_state(|| None::<web_sys::File>);
    let error = use_state(|| None::<String>);

    let fetch_projects = {
        let projects = projects.clone();
        let loading = loading.clone();
        let error = error.clone();

        Callback::from(move |_| {
            let projects = projects.clone();
            let loading = loading.clone();
            let error = error.clone();

            wasm_bindgen_futures::spawn_local(async move {
                loading.set(true);
                match api::fetch_projects().await {
                    Ok(data) => {
                        projects.set(data);
                        error.set(None);
                    }
                    Err(message) => {
                        error.set(Some(message));
                    }
                }
                loading.set(false);
            });
        })
    };

    // Initial load
    {
        let fetch_projects = fetch_projects.clone();
        use_effect_with((), move |_| {
            fetch_projects.emit(());
            || ()
        });
    }

    let on_file_change = {
        let selected_file = selected_file.clone();

        Callback::from(move |event: Event| {
            let input = event.target_unchecked_into::<HtmlInputElement>();
            selected_file.set(input.files().and_then(|files| files.get(0)));
        })
    };

    let on_upload = {
        let selected_file = selected_file.clone();
        let uploading = uploading.clone();
        let error = error.clone();
        let fetch_projects = fetch_projects.clone();

        Callback::from(move |_| {
            let Some(file) = (*selected_file).clone() else {
                return;
            };
            let uploading = uploading.clone();
            let error = error.clone();
            let fetch_projects = fetch_projects.clone();

            wasm_bindgen_futures::spawn_local(async move {
                uploading.set(true);
                match api::upload_archive(&file).await {
                    Ok(_) => {
                        error.set(None);
                        fetch_projects.emit(());
                    }
                    Err(message) => error.set(Some(message)),
                }
                uploading.set(false);
            });
        })
    };

    html! {
        <div class="container">
            <header>
                <h1>{"LAN Host Manager"}</h1>
            </header>

            <div class="card">
                <h2 style="margin-bottom: 16px;">{"Upload project"}</h2>
                <div class="upload-bar">
                    <input
                        type="file"
                        accept=".zip,.rar"
                        onchange={on_file_change}
                        disabled={*uploading}
                    />
                    <button
                        class="btn-primary"
                        onclick={on_upload}
                        disabled={*uploading || selected_file.is_none()}
                    >
                        { if *uploading { "Uploading..." } else { "Upload archive" } }
                    </button>
                </div>
                <p class="hint">
                    {"Upload a .zip or .rar archive of a static site or Node project. "}
                    {"The project is extracted, detected and assigned a free port automatically."}
                </p>
            </div>

            if let Some(err) = (*error).clone() {
                <div class="error">{err}</div>
            }

            if *loading {
                <div class="loading">{"Loading projects..."}</div>
            } else {
                <div class="card">
                    <h2 style="margin-bottom: 16px;">{"Projects"}</h2>
                    if (*projects).is_empty() {
                        <p style="color: #6b7280;">{"No projects yet. Upload an archive to get started."}</p>
                    } else {
                        <div class="project-list">
                            {for (*projects).iter().map(|project| {
                                html! {
                                    <ProjectCard
                                        project={project.clone()}
                                        on_refresh={fetch_projects.clone()}
                                    />
                                }
                            })}
                        </div>
                    }
                </div>
            }
        </div>
    }
}

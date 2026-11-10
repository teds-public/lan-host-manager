use yew::prelude::*;
use crate::{api, types::Project, components::project_card::ProjectCard};

#[function_component(ProjectList)]
pub fn project_list() -> Html {
    let projects = use_state(|| Vec::<Project>::new());
    let loading = use_state(|| true);
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
                    Err(e) => {
                        error.set(Some(e));
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

    html! {
        <div class="container">
            <header>
                <h1>{"LAN Host Manager"}</h1>
            </header>

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

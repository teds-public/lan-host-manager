mod api;
mod components;
mod types;

use yew::prelude::*;
use components::project_list::ProjectList;

#[function_component(App)]
fn app() -> Html {
    html! {
        <ProjectList />
    }
}

fn main() {
    yew::Renderer::<App>::new().render();
}
